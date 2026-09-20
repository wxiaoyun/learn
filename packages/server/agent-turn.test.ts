import { afterEach, describe, expect, test } from "bun:test"
import {
  serializeNodes,
  serializeQuizPlan,
  serializeRoadmap,
  type Nodes,
  type QuizPlan,
  type Roadmap,
} from "@learn/core"
import { nodesPath, quizPlanPath, roadmapPath } from "@learn/core/node"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { startServer, type RunningServer } from "./server"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

const nodes: Nodes = [{
  id: "first-node",
  title: "First Node",
  summary: "The first Node supplies a foundation.",
  dependsOn: [],
  taughtAt: [{ unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 5 } }],
}, {
  id: "second-node",
  title: "Second Node",
  summary: "The second Node builds on the first Node.",
  dependsOn: ["first-node"],
  taughtAt: [{ unitId: "second-unit", anchor: { kind: "video-timestamp", seconds: 5 } }],
}]

function roadmap(courseId: string): Roadmap {
  return {
    courseId,
    title: `Course ${courseId}`,
    goal: "Learn two Nodes",
    sourceMaterials: [{ title: "Videos", reference: "https://example.com" }],
    units: [{
      id: "first-unit",
      title: "First Unit",
      order: 0,
      topics: ["first"],
      dependsOn: [],
      kind: "youtube-video",
      source: { videoId: `${courseId}-first`, url: `https://youtube.com/watch?v=${courseId}-first` },
    }, {
      id: "second-unit",
      title: "Second Unit",
      order: 1,
      topics: ["second"],
      dependsOn: ["first-unit"],
      kind: "youtube-video",
      source: { videoId: `${courseId}-second`, url: `https://youtube.com/watch?v=${courseId}-second` },
    }],
  }
}

function firstPlan(courseId: string): QuizPlan {
  return {
    courseId,
    unitId: "first-unit",
    nodeIds: ["first-node"],
    questionPool: [{
      id: "first-recall",
      nodeId: "first-node",
      tier: "recall",
      kind: "choice",
      prompt: "Which Node comes first?",
      options: ["First", "Second"],
      correctIndex: 0,
      explanation: "The first Node comes first.",
    }, {
      id: "first-apply",
      nodeId: "first-node",
      tier: "application",
      kind: "choice",
      prompt: "Apply the first Node.",
      options: ["Apply it", "Ignore it"],
      correctIndex: 0,
      explanation: "Applying it uses the Node.",
    }, {
      id: "first-explain",
      nodeId: "first-node",
      tier: "application",
      kind: "explain-back",
      prompt: "Explain the first Node.",
      rubric: "The answer identifies the first Node as a foundation.",
    }],
    placements: [],
  }
}

function secondPlan(courseId: string): QuizPlan {
  return {
    courseId,
    unitId: "second-unit",
    nodeIds: ["second-node"],
    questionPool: [{
      id: "second-recall",
      nodeId: "second-node",
      tier: "recall",
      kind: "choice",
      prompt: "Which Node comes second?",
      options: ["Second", "First"],
      correctIndex: 0,
      explanation: "The second Node comes second.",
    }, {
      id: "second-apply",
      nodeId: "second-node",
      tier: "application",
      kind: "choice",
      prompt: "Apply the second Node.",
      options: ["Apply it", "Ignore it"],
      correctIndex: 0,
      explanation: "Applying it uses the Node.",
    }],
    placements: [],
  }
}

async function writeCourse(root: string, courseId: string, includeSecondPlan = false): Promise<void> {
  const values: Array<[string, string]> = [
    [roadmapPath(root, courseId), serializeRoadmap(roadmap(courseId))],
    [nodesPath(root, courseId), serializeNodes(nodes)],
    [quizPlanPath(root, courseId, "first-unit"), serializeQuizPlan(firstPlan(courseId))],
  ]
  if (includeSecondPlan) values.push([
    quizPlanPath(root, courseId, "second-unit"),
    serializeQuizPlan(secondPlan(courseId)),
  ])
  for (const [file, text] of values) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text, "utf8")
  }
  const transcript = join(root, courseId, "sources", "youtube", `${courseId}-second.en.vtt`)
  await mkdir(dirname(transcript), { recursive: true })
  await writeFile(transcript, "WEBVTT\n\n00:00.000 --> 00:05.000\nSource text.\n", "utf8")
}

async function fixture(input: {
  agent?: "claude" | "off"
  timeoutMs?: number
  debounceMs?: number
  mode?: "grade" | "noop"
  sleepMs?: number
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "learn-agent-root-"))
  const bin = await mkdtemp(join(tmpdir(), "learn-agent-bin-"))
  const control = join(root, "stub-control.json")
  const calls = join(root, "stub-calls.jsonl")
  await writeFile(control, JSON.stringify({ mode: input.mode ?? "grade", sleepMs: input.sleepMs ?? 0 }), "utf8")
  const stub = `#!/usr/bin/env bun
import { appendFile, readFile } from "node:fs/promises"
const control = JSON.parse(await readFile(process.env.STUB_CONTROL!, "utf8"))
const calls = process.env.STUB_CALLS!
const event = (name: string) => appendFile(calls, JSON.stringify({ event: name, kind: process.env.LEARNING_AGENT_KIND, outcomeId: process.env.LEARNING_OUTCOME_ID, unitId: process.env.LEARNING_UNIT_ID, at: Date.now() }) + "\\n")
await event("start")
if (control.sleepMs) await Bun.sleep(control.sleepMs)
if (control.mode === "grade" && process.env.LEARNING_AGENT_KIND === "grade") {
  const state = await fetch("http://127.0.0.1:" + process.env.LEARNING_PORT + "/tools/get_course_state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId: process.env.LEARNING_COURSE_ID }) }).then((response) => response.json()) as any
  const outcome = state.ungradedExplainBacks.find((value: any) => value.id === process.env.LEARNING_OUTCOME_ID)
  if (outcome) await fetch("http://127.0.0.1:" + process.env.LEARNING_PORT + "/tools/append_grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId: process.env.LEARNING_COURSE_ID, grade: { type: "grade", outcomeId: outcome.id, nodeId: outcome.nodeId, judgment: "partial", missing: "The explanation missed one supporting detail." } }) })
}
await event("end")
console.log(JSON.stringify({ total_cost_usd: 0 }))
`
  await writeFile(join(bin, "claude"), stub, "utf8")
  await chmod(join(bin, "claude"), 0o755)
  const running = await startServer({
    root,
    port: 0,
    allowedOrigins: [],
    agent: input.agent ?? "claude",
    agentTimeoutMs: input.timeoutMs ?? 2_000,
    recapDebounceMs: input.debounceMs ?? 30,
  }, {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    STUB_CONTROL: control,
    STUB_CALLS: calls,
  })
  const base = `http://127.0.0.1:${running.port}`
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, init)
    const text = await response.text()
    return { response, body: text ? JSON.parse(text) : undefined }
  }
  const postOutcome = (body: Record<string, unknown>) => request("/outcomes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const events = async (): Promise<Array<Record<string, unknown>>> => {
    try {
      return (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }
  const close = async () => {
    await running.close()
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
  cleanups.push(close)
  return { root, base, running, control, calls, request, postOutcome, events, close }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(20)
  }
  throw new Error("condition not met before timeout")
}

function explain(courseId: string, surface: "youtube" | "agent", answeredAt: string, text = "A foundation supports what follows.") {
  return {
    type: "outcome",
    courseId,
    unitId: "first-unit",
    questionId: "first-explain",
    nodeId: "first-node",
    tier: "application",
    surface,
    status: "ungraded",
    text,
    answeredAt,
  }
}

function recap(courseId: string, questionId: string, answeredAt: string) {
  return {
    type: "outcome",
    courseId,
    unitId: "first-unit",
    questionId,
    nodeId: "first-node",
    tier: "application",
    placementKey: "recap",
    surface: "youtube",
    status: "correct",
    chosenIndex: 0,
    answeredAt,
  }
}

describe("server-started agent turns", () => {
  test("off starts nothing", async () => {
    const value = await fixture({ agent: "off" })
    await writeCourse(value.root, "off-course")
    await value.postOutcome(explain("off-course", "youtube", "2026-03-21T10:00:00.000Z"))
    await Bun.sleep(80)
    expect(await value.events()).toEqual([])
  })

  test("grades YouTube Explain-backs, ignores agent surface, and serves encoded ids", async () => {
    const value = await fixture()
    await writeCourse(value.root, "grade-course")
    await value.postOutcome(explain("grade-course", "agent", "2026-03-21T10:00:00.000Z"))
    const learnerText = "A foundation supports later Nodes. INJECTION_TOKEN_921"
    const posted = await value.postOutcome(explain("grade-course", "youtube", "2026-03-21T10:01:00.000Z", learnerText))
    const outcomeId = posted.body.results[0].id as string
    await waitFor(async () => (await value.request(`/grades/${encodeURIComponent(outcomeId)}`)).response.status === 200)
    const grade = await value.request(`/grades/${encodeURIComponent(outcomeId)}`)
    expect(grade.body).toEqual(expect.objectContaining({
      outcomeId,
      judgment: "partial",
      missing: "The explanation missed one supporting detail.",
    }))
    expect((await value.events()).filter((event) => event.event === "start")).toHaveLength(1)
    const log = await readFile(join(value.root, ".logs", "server.jsonl"), "utf8")
    expect(log).not.toContain(learnerText)
    expect(log).not.toContain("INJECTION_TOKEN_921")
    expect(log).toContain('"status":"ok"')
  })

  test("marks a successful process failed when expected state is absent", async () => {
    const value = await fixture({ mode: "noop" })
    await writeCourse(value.root, "missing-state")
    const posted = await value.postOutcome(explain("missing-state", "youtube", "2026-03-21T10:00:00.000Z"))
    const outcomeId = posted.body.results[0].id as string
    await waitFor(async () => {
      const log = await readFile(join(value.root, ".logs", "server.jsonl"), "utf8").catch(() => "")
      return log.includes("expected state missing")
    })
    expect((await value.request(`/grades/${encodeURIComponent(outcomeId)}`)).response.status).toBe(404)
  })

  test("runs one turn at a time", async () => {
    const value = await fixture({ sleepMs: 80 })
    await writeCourse(value.root, "queue-course")
    await Promise.all([
      value.postOutcome(explain("queue-course", "youtube", "2026-03-21T10:00:00.000Z")),
      value.postOutcome(explain("queue-course", "youtube", "2026-03-21T10:01:00.000Z")),
    ])
    await waitFor(async () => (await value.events()).filter((event) => event.event === "end").length === 2)
    expect((await value.events()).map((event) => event.event)).toEqual(["start", "end", "start", "end"])
  })

  test("kills timed out turns and logs timeout", async () => {
    const value = await fixture({ mode: "noop", sleepMs: 500, timeoutMs: 50 })
    await writeCourse(value.root, "timeout-course")
    await value.postOutcome(explain("timeout-course", "youtube", "2026-03-21T10:00:00.000Z"))
    await waitFor(async () => {
      const log = await readFile(join(value.root, ".logs", "server.jsonl"), "utf8").catch(() => "")
      return log.includes('"status":"timeout"')
    })
    expect((await value.events()).map((event) => event.event)).toEqual(["start"])
  })

  test("derives all missing-plan hints and debounces generation", async () => {
    const value = await fixture({ mode: "noop", sleepMs: 300, debounceMs: 30 })
    await writeCourse(value.root, "primer-course")
    let response = await value.request("/quiz-plans/by-video/primer-course-second")
    expect(response.response.status).toBe(404)
    expect(response.body).toEqual(expect.objectContaining({
      courseVideo: true,
      hint: "no quiz plan yet, run a primer first",
    }))

    await writeCourse(value.root, "weak-course")
    await value.postOutcome({
      ...recap("weak-course", "weak-question", "2026-03-21T09:00:00.000Z"),
      placementKey: "pause:5",
      status: "wrong",
      chosenIndex: 1,
    })
    response = await value.request("/quiz-plans/by-video/weak-course-second")
    expect(response.body.hint).toContain("visit the agent first")
    expect(response.body.hint).toContain("First Node")

    await writeCourse(value.root, "generate-course")
    await Promise.all([
      value.postOutcome(recap("generate-course", "recap-one", "2026-03-21T10:00:00.000Z")),
      value.postOutcome(recap("generate-course", "recap-two", "2026-03-21T10:00:01.000Z")),
      value.postOutcome(recap("generate-course", "recap-three", "2026-03-21T10:00:02.000Z")),
    ])
    await waitFor(async () => (await value.events()).some((event) => event.kind === "quiz-plan" && event.event === "start"))
    response = await value.request("/quiz-plans/by-video/generate-course-second")
    expect(response.body.hint).toBe("a quiz plan is being generated, reload in a minute")
    await waitFor(async () => (await value.events()).some((event) => event.kind === "quiz-plan" && event.event === "end"))
    expect((await value.events()).filter((event) => event.kind === "quiz-plan" && event.event === "start")).toHaveLength(1)

    await writeCourse(value.root, "planned-course", true)
    await value.postOutcome(recap("planned-course", "recap-planned", "2026-03-21T11:00:00.000Z"))
    await Bun.sleep(100)
    expect((await value.events()).filter((event) => event.kind === "quiz-plan" && event.event === "start")).toHaveLength(1)
  })
})
