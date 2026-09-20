import { appendFile, mkdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  SlugSchema,
  log,
  parseOutcomes,
  serializeOutcome,
  type OutcomeRecord,
} from "./schema"
import * as Schema from "effect/Schema"

export async function appendOutcome(
  file: string,
  outcome: OutcomeRecord,
): Promise<"appended" | "duplicate"> {
  log("info", "outcome_append", { target: file, status: "start" })
  try {
    const serialized = serializeOutcome(outcome)
    let existing = ""
    try {
      existing = await readFile(file, "utf8")
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    const parsed = parseOutcomes(existing, file)
    if (!parsed.ok) throw new Error(parsed.error)
    if (parsed.value.some((record) => record.id === outcome.id)) {
      log("info", "outcome_append", { target: file, status: "duplicate" })
      return "duplicate"
    }
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, serialized, "utf8")
    log("info", "outcome_append", { target: file, status: "appended" })
    return "appended"
  } catch (error) {
    log("error", "outcome_append", {
      target: file,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export function getLearningRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LEARNING_ROOT?.trim()
  if (!configured) return join(homedir(), "learning")
  if (configured === "~") return homedir()
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2))
  return resolve(configured)
}

function checkedSlug(value: string, field: string): string {
  const decoded = Schema.decodeUnknownEither(SlugSchema)(value)
  if (decoded._tag === "Left") throw new Error(`${field}: must be a lowercase slug`)
  return decoded.right
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

export function learningDashboardPath(root: string, courseId: string): string {
  return join(coursePath(root, courseId), "LEARNING.md")
}
