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
import { parseVtt, transcriptSections } from "./agent-turn"
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
  const sourceDirectory = join(root, courseId, "sources", "youtube")
  await mkdir(sourceDirectory, { recursive: true })
  for (const video of ["first", "second"]) {
    await writeFile(
      join(sourceDirectory, `${courseId}-${video}.en.vtt`),
      "WEBVTT\n\n00:00.000 --> 00:05.000\nSource text.\n",
      "utf8",
    )
  }
}

async function fixture(input: {
  agent?: "claude" | "off"
  timeoutMs?: number
  debounceMs?: number
  mode?: "grade" | "answer" | "noop"
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
if (control.mode === "answer" && process.env.LEARNING_AGENT_KIND === "ask") {
  await fetch("http://127.0.0.1:" + process.env.LEARNING_PORT + "/tools/answer_ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId: process.env.LEARNING_COURSE_ID, askId: process.env.LEARNING_ASK_ID, text: "ANSWER_SECRET_417 The foundation supports the next step.", nodeIds: ["first-node"] }) })
}
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
  const postAsk = (body: Record<string, unknown>) => request("/asks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
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
  return { root, base, running, control, calls, request, postAsk, postOutcome, events, close }
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

function ask(courseId: string, askedAt: string, text = "ASK_SECRET_319 How does this fit?") {
  return {
    type: "ask",
    courseId,
    unitId: "first-unit",
    location: { unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 4 } },
    text,
    surface: "youtube",
    askedAt,
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

describe("VTT context", () => {
  test("removes settings, timing tags, and rolling caption duplicates", () => {
    const cues = parseVtt(`WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start position:0%\n<c>Hello</c>\n\n00:00:02.000 --> 00:00:03.000\n<00:00:02.200><c>Hello world</c>\n\n00:00:03.000 --> 00:00:04.000\nHello world\nagain\n`)
    expect(cues).toEqual([
      { start: 1, text: "Hello" },
      { start: 2, text: "world" },
      { start: 3, text: "again" },
    ])
  })

  test("splits covered, just watched, and later cues", () => {
    const sections = transcriptSections([
      { start: 1, text: "early" },
      { start: 100, text: "recent" },
      { start: 230, text: "later" },
    ], 200)
    expect(sections.upTo).toContain("COVERED EARLIER\n0:01 early")
    expect(sections.upTo).toContain("JUST WATCHED, LAST TWO MINUTES\n1:40 recent")
    expect(sections.later).toBe("3:50 later")
  })

  test("caps long covered transcript", () => {
    const sections = transcriptSections(Array.from({ length: 800 }, (_, index) => ({
      start: index,
      text: `cue-${index}-${"x".repeat(100)}`,
    })), 799)
    expect(sections.cut).toBe(true)
    expect(sections.upTo).toContain("MIDDLE OF COVERED TRANSCRIPT CUT")
    expect(sections.upTo.length).toBeLessThan(61_000)
  })
})

describe("Asks", () => {
  test("returns 503 while off and stores nothing", async () => {
    const value = await fixture({ agent: "off" })
    await writeCourse(value.root, "ask-off")
    const result = await value.postAsk(ask("ask-off", "2026-03-21T10:00:00.000Z"))
    expect(result.response.status).toBe(503)
    expect(result.body.error).toContain("asks are disabled")
    expect(await readFile(join(value.root, "ask-off", "asks.jsonl"), "utf8").catch(() => "missing")).toBe("missing")
  })

  test("answers once, judges success by state, and keeps texts out of logs", async () => {
    const value = await fixture({ mode: "answer" })
    await writeCourse(value.root, "ask-success")
    const input = ask("ask-success", "2026-03-21T10:00:00.000Z")
    const first = await value.postAsk(input)
    const second = await value.postAsk(input)
    expect(first.body.status).toBe("appended")
    expect(second.body.status).toBe("duplicate")
    const askId = first.body.id as string
    await waitFor(async () => (await value.request(`/asks/${encodeURIComponent(askId)}`)).body.answer !== null)
    const state = await value.request(`/asks/${encodeURIComponent(askId)}`)
    expect(state.body.answer).toEqual(expect.objectContaining({
      askId,
      text: "ANSWER_SECRET_417 The foundation supports the next step.",
      nodeIds: ["first-node"],
    }))
    expect(state.body.failed).toBe(false)
    expect((await value.events()).filter((event) => event.kind === "ask" && event.event === "start")).toHaveLength(1)
    const log = await readFile(join(value.root, ".logs", "server.jsonl"), "utf8")
    expect(log).not.toContain("ASK_SECRET_319")
    expect(log).not.toContain("ANSWER_SECRET_417")
    expect(log).toContain('"status":"ok"')
  })

  test("reports a failed turn that writes no Answer", async () => {
    const value = await fixture({ mode: "noop" })
    await writeCourse(value.root, "ask-failed")
    const posted = await value.postAsk(ask("ask-failed", "2026-03-21T10:00:00.000Z"))
    await waitFor(async () => (await value.request(`/asks/${encodeURIComponent(posted.body.id)}`)).body.failed === true)
    const result = await value.request(`/asks/${encodeURIComponent(posted.body.id)}`)
    expect(result.body.answer).toBeNull()
    expect(result.body.failed).toBe(true)
  })

  test("rejects a Unit outside the Roadmap", async () => {
    const value = await fixture({ mode: "noop" })
    await writeCourse(value.root, "ask-unit")
    const result = await value.postAsk({
      ...ask("ask-unit", "2026-03-21T10:00:00.000Z"),
      unitId: "missing-unit",
      location: { unitId: "missing-unit", anchor: { kind: "video-timestamp", seconds: 1 } },
    })
    expect(result.response.status).toBe(400)
    expect(result.body.error).toContain("not a Roadmap video Unit")
  })

  test("validates tagged Nodes, rejects a second Answer, and orders history", async () => {
    const value = await fixture({ mode: "noop", sleepMs: 100 })
    await writeCourse(value.root, "ask-tool")
    const later = await value.postAsk(ask("ask-tool", "2026-03-21T10:01:00.000Z", "Later Ask"))
    const earlier = await value.postAsk(ask("ask-tool", "2026-03-21T10:00:00.000Z", "Earlier Ask"))
    const tool = (name: string, body: unknown) => value.request(`/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const unknown = await tool("answer_ask", {
      courseId: "ask-tool",
      askId: earlier.body.id,
      text: "An Answer.",
      nodeIds: ["missing-node"],
    })
    expect(unknown.response.status).toBe(400)
    expect(unknown.body.error).toContain('Node id "missing-node" does not exist')
    const answered = await tool("answer_ask", {
      courseId: "ask-tool",
      askId: earlier.body.id,
      text: "An Answer.",
      nodeIds: ["first-node"],
    })
    const duplicate = await tool("answer_ask", {
      courseId: "ask-tool",
      askId: earlier.body.id,
      text: "A different Answer.",
      nodeIds: [],
    })
    expect(answered.body.status).toBe("appended")
    expect(duplicate.body.status).toBe("duplicate")
    const state = await tool("get_course_state", { courseId: "ask-tool" })
    expect(state.body.nodeSummaries[0]).toEqual(expect.objectContaining({
      nodeId: "first-node",
      askCount: 1,
      latestAskAt: "2026-03-21T10:00:00.000Z",
    }))
    expect(state.body.recentAsks).toHaveLength(1)
    const history = await value.request("/asks/by-video/ask-tool-first")
    expect(history.body.asks.map((item: any) => item.ask.id)).toEqual([earlier.body.id, later.body.id])
  })
})

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
    const value = await fixture({ mode: "noop", sleepMs: 500, timeoutMs: 150 })
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

    const repeated = await fixture({ mode: "answer" })
    await writeCourse(repeated.root, "repeated-asks")
    const now = Date.now()
    await repeated.postAsk(ask("repeated-asks", new Date(now - 2_000).toISOString(), "First Ask"))
    await repeated.postAsk(ask("repeated-asks", new Date(now - 1_000).toISOString(), "Second Ask"))
    await waitFor(async () => {
      const history = await repeated.request("/asks/by-video/repeated-asks-first")
      return history.body.asks.filter((item: any) => item.answer).length === 2
    })
    response = await repeated.request("/quiz-plans/by-video/repeated-asks-second")
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
