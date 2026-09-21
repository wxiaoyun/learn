import { appendFile, mkdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  SlugSchema,
  log,
  parseAsks,
  parseOutcomes,
  serializeAsk,
  serializeOutcome,
  type AskRecord,
  type OutcomeRecord,
} from "./schema"
import * as Schema from "effect/Schema"

async function appendRecord<T extends { readonly id: string }>(input: {
  file: string
  record: T
  stage: string
  parse: (text: string, file: string) => { ok: true; value: T[] } | { ok: false; error: string }
  serialize: (record: T) => string
  duplicate: (records: T[], record: T) => boolean
}): Promise<"appended" | "duplicate"> {
  log("info", input.stage, { target: input.file, status: "start" })
  try {
    const serialized = input.serialize(input.record)
    let existing = ""
    try {
      existing = await readFile(input.file, "utf8")
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    const parsed = input.parse(existing, input.file)
    if (!parsed.ok) throw new Error(parsed.error)
    if (input.duplicate(parsed.value, input.record)) {
      log("info", input.stage, { target: input.file, status: "duplicate" })
      return "duplicate"
    }
    await mkdir(dirname(input.file), { recursive: true })
    await appendFile(input.file, serialized, "utf8")
    log("info", input.stage, { target: input.file, status: "appended" })
    return "appended"
  } catch (error) {
    log("error", input.stage, {
      target: input.file,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function appendOutcome(
  file: string,
  outcome: OutcomeRecord,
): Promise<"appended" | "duplicate"> {
  return appendRecord({
    file,
    record: outcome,
    stage: "outcome_append",
    parse: parseOutcomes,
    serialize: serializeOutcome,
    duplicate: (records, record) => records.some((candidate) => candidate.id === record.id),
  })
}

export async function appendAsk(
  file: string,
  record: AskRecord,
): Promise<"appended" | "duplicate"> {
  return appendRecord({
    file,
    record,
    stage: "ask_append",
    parse: parseAsks,
    serialize: serializeAsk,
    duplicate: (records, candidate) => records.some((existing) => existing.id === candidate.id
      || (candidate.type === "answer" && existing.type === "answer" && existing.askId === candidate.askId)),
  })
}

export function getLearningRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LEARNING_ROOT?.trim()
  if (!configured) return join(homedir(), "learning")
  if (configured === "~") return homedir()
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2))
  return resolve(configured)
}

function checkedSlug(value: string, field: string): string {
  const decoded = Schema.decodeUnknownResult(SlugSchema)(value)
  if (decoded._tag === "Failure") throw new Error(`${field}: must be a lowercase slug`)
  return decoded.success
}

export function coursePath(root: string, courseId: string): string {
  return join(root, checkedSlug(courseId, "courseId"))
}

export function roadmapPath(root: string, courseId: string): string {
  return join(coursePath(root, courseId), "roadmap.json")
}

export function nodesPath(root: string, courseId: string): string {
  return join(coursePath(root, courseId), "nodes.json")
}

export function quizPlanPath(root: string, courseId: string, unitId: string): string {
  return join(coursePath(root, courseId), "quiz-plans", `${checkedSlug(unitId, "unitId")}.json`)
}

export function outcomesPath(root: string, courseId: string): string {
  return join(coursePath(root, courseId), "outcomes.jsonl")
}

export function asksPath(root: string, courseId: string): string {
  return join(coursePath(root, courseId), "asks.jsonl")
}

export function learningDashboardPath(root: string, courseId: string): string {
  return join(coursePath(root, courseId), "LEARNING.md")
}
