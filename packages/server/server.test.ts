import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  createGradeId,
  createOutcomeId,
  serializeNodes,
  serializeQuizPlan,
  serializeRoadmap,
  type Nodes,
  type Outcome,
  type QuizPlan,
  type Roadmap,
} from "@learn/core"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { outcomesPath, quizPlanPath, roadmapPath } from "@learn/core/node"
import { startServer, type RunningServer } from "./server"
import { agentTools } from "./tools"

let root = ""
let base = ""
let running: RunningServer

const roadmap = (courseId: string, videoId: string): Roadmap => ({
  courseId,
  title: `Course ${courseId}`,
  goal: "Understand one node",
  sourceMaterials: [{ title: "Playlist", reference: "https://example.com/playlist" }],
  units: [{
    id: "first-unit",
    kind: "youtube-video",
    title: "First unit",
    source: { videoId, url: `https://www.youtube.com/watch?v=${videoId}` },
    order: 0,
    topics: ["foundation"],
    dependsOn: [],
  }],
})

const question = (id: string, tier: "recall" | "application") => ({
  id,
  nodeId: "core-node",
  tier,
  kind: "choice" as const,
  prompt: `Prompt ${id}`,
  options: ["Correct", "Wrong"],
  correctIndex: 0,
  explanation: "Correct is correct.",
})

const plan = (courseId: string): QuizPlan => ({
  courseId,
  unitId: "first-unit",
  nodeIds: ["core-node"],
  questionPool: [question("question-1", "recall"), question("question-2", "application")],
  placements: [],
})

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  return { response, text, body: text ? JSON.parse(text) : undefined }
}

// The streamable HTTP transport is session based and wants both media types on
// Accept, so MCP calls open a session first and reuse its id.
const protocolVersion = "2025-06-18"

async function mcp(body: unknown, headers: Record<string, string> = {}) {
  return request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function putTool(name: string, body: unknown) {
  return request(`/tools/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "learn-server-"))
  running = await startServer({
    root,
    port: 0,
    allowedOrigins: ["chrome-extension://allowed"],
    agent: "off",
    agentTimeoutMs: 300_000,
    recapDebounceMs: 20_000,
  })
  base = `http://127.0.0.1:${running.port}`
})

afterAll(async () => {
  await running.close()
  await rm(root, { recursive: true, force: true })
})

describe("HTTP boundaries", () => {
  test("rejects an unknown origin and allows a configured origin", async () => {
    const rejected = await request("/health", { headers: { origin: "https://evil.example" } })
    expect(rejected.response.status).toBe(403)
    expect(rejected.body.error).toContain("origin not allowed")

    const allowed = await request("/health", { headers: { origin: "chrome-extension://allowed" } })
    expect(allowed.response.status).toBe(200)
    expect(allowed.response.headers.get("access-control-allow-origin")).toBe("chrome-extension://allowed")

    const preflight = await request("/outcomes", {
      method: "OPTIONS",
      headers: {
        origin: "chrome-extension://allowed",
        "access-control-request-method": "POST",
      },
    })
    expect(preflight.response.status).toBe(204)
    expect(preflight.response.headers.get("access-control-allow-origin")).toBe("chrome-extension://allowed")
  })

  test("finds a quiz plan by video and returns 404 when absent", async () => {
    const course = roadmap("lookup-course", "lookup-video")
    const quizPlan = plan(course.courseId)
    for (const [file, contents] of [
      [roadmapPath(root, course.courseId), serializeRoadmap(course)],
      [quizPlanPath(root, course.courseId, quizPlan.unitId), serializeQuizPlan(quizPlan)],
    ] as const) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents, "utf8")
    }
    const answeredAt = "2026-03-19T10:00:00.000Z"
    const outcome: Outcome = {
      type: "outcome",
      id: createOutcomeId({ questionId: "question-1", surface: "youtube", answeredAt }),
      courseId: course.courseId,
      unitId: "first-unit",
      questionId: "question-1",
      nodeId: "core-node",
      surface: "youtube",
      status: "correct",
      chosenIndex: 0,
      answeredAt,
    }
    const { id: _id, ...outcomeInput } = outcome
    const earlierWrong = {
      ...outcomeInput,
      status: "wrong" as const,
      chosenIndex: 1,
      answeredAt: "2026-03-19T09:00:00.000Z",
    }
    for (const input of [earlierWrong, outcomeInput]) {
      expect((await request("/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })).response.status).toBe(200)
    }

    const hit = await request("/quiz-plans/by-video/lookup-video")
    expect(hit.response.status).toBe(200)
    expect(hit.body.courseId).toBe(course.courseId)
    expect(hit.body.unitId).toBe("first-unit")
    expect(hit.body.answeredQuestionIds).toEqual(["question-1"])
    expect(hit.body.correctQuestionIds).toEqual(["question-1"])
    expect(hit.body.wrongQuestionIds).toEqual([])
    expect(hit.body.answeredPlacementKeys).toEqual([])

    const miss = await request("/quiz-plans/by-video/missing-video")
    expect(miss.response.status).toBe(404)
    expect(miss.body.error).toContain("no quiz plan exists")
  })

  test("tracks replacement, skipped, flagged, and legacy placement completion", async () => {
    const course = roadmap("placement-course", "placement-video")
    const quizPlan: QuizPlan = {
      ...plan(course.courseId),
      questionPool: [
        question("question-1", "recall"),
        question("question-2", "application"),
        question("question-3", "recall"),
        question("question-4", "application"),
        question("question-5", "recall"),
        question("question-6", "application"),
      ],
      placements: [
        {
          kind: "pause",
          location: { unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 10 } },
          nodeIds: ["core-node"],
          questionIds: ["question-1", "question-2"],
        },
        {
          kind: "pause",
          location: { unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 40 } },
          nodeIds: ["core-node"],
          questionIds: ["question-3"],
        },
        {
          kind: "pause",
          location: { unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 70 } },
          nodeIds: ["core-node"],
          questionIds: ["question-5", "question-6"],
        },
      ],
    }
    for (const [file, contents] of [
      [roadmapPath(root, course.courseId), serializeRoadmap(course)],
      [quizPlanPath(root, course.courseId, quizPlan.unitId), serializeQuizPlan(quizPlan)],
    ] as const) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents, "utf8")
    }
    const inputs = [
      { questionId: "replacement-one", status: "correct", placementKey: "pause:10" },
      { questionId: "replacement-two", status: "flagged", placementKey: "pause:10" },
      { questionId: "replacement-three", status: "skipped", placementKey: "pause:40" },
      { questionId: "question-5", status: "correct" },
      { questionId: "question-6", status: "correct" },
    ] as const
    for (const [index, input] of inputs.entries()) {
      const posted = await request("/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "outcome",
          courseId: course.courseId,
          unitId: "first-unit",
          nodeId: "core-node",
          tier: "application",
          surface: "youtube",
          answeredAt: `2026-03-20T10:0${index}:00.000Z`,
          ...input,
        }),
      })
      expect(posted.response.status).toBe(200)
    }

    const result = await request("/quiz-plans/by-video/placement-video")
    expect(result.response.status).toBe(200)
    expect(result.body.answeredPlacementKeys).toEqual(["pause:10", "pause:70"])
  })

  test("appends an outcome once and skips its duplicate", async () => {
    const answeredAt = "2026-03-20T10:00:00.000Z"
    const outcome: Outcome = {
      type: "outcome",
      id: createOutcomeId({ questionId: "duplicate-question", surface: "agent", answeredAt }),
      courseId: "duplicate-course",
      unitId: "first-unit",
      questionId: "duplicate-question",
      nodeId: "core-node",
      surface: "agent",
      status: "wrong",
      chosenIndex: 1,
      answeredAt,
    }
    const { id: _id, ...outcomeInput } = outcome
    const first = await request("/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(outcomeInput),
    })
    const second = await request("/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(outcomeInput),
    })
    expect(first.body.results[0].status).toBe("appended")
    expect(second.body.results[0].status).toBe("duplicate")
    expect((await readFile(outcomesPath(root, outcome.courseId), "utf8")).trim().split("\n")).toHaveLength(1)
  })
})

describe("agent tools", () => {
  test("emits flat JSON Schema inputs", () => {
    for (const tool of agentTools) {
      const schema = JSON.stringify(tool.jsonSchema)
      expect(schema).not.toContain('"$ref"')
      expect(schema).not.toContain('"$defs"')
      expect(tool.jsonSchema.type).toBe("object")
    }
  })

  test("rejects an invalid quiz plan with a readable error", async () => {
    const invalid = {
      ...plan("invalid-plan-course"),
      questionPool: [question("question-1", "recall")],
    }
    const result = await putTool("put_quiz_plan", {
      courseId: invalid.courseId,
      unitId: invalid.unitId,
      plan: invalid,
    })
    expect(result.response.status).toBe(400)
    expect(result.body.error).toContain("needs recall and application questions")
  })

  test("rejects Question ids already used by another Unit", async () => {
    const course: Roadmap = {
      ...roadmap("question-owner", "question-owner-video"),
      units: [
        ...roadmap("question-owner", "question-owner-video").units,
        {
          id: "second-unit",
          kind: "document",
          title: "Second unit",
          source: { reference: "chapter-two" },
          order: 1,
          topics: ["foundation"],
          dependsOn: [],
        },
      ],
    }
    expect((await putTool("put_roadmap", { roadmap: course })).response.status).toBe(200)
    const first = plan(course.courseId)
    expect((await putTool("put_quiz_plan", {
      courseId: course.courseId,
      unitId: first.unitId,
      plan: first,
    })).response.status).toBe(200)
    const second = { ...first, unitId: "second-unit" }
    const collision = await putTool("put_quiz_plan", {
      courseId: course.courseId,
      unitId: second.unitId,
      plan: second,
    })
    expect(collision.response.status).toBe(400)
    expect(collision.body.error).toContain('question id "question-1"')
    expect(collision.body.error).toContain('unit "first-unit"')
  })

  test("rejects a video ID already owned by another course", async () => {
    const first = await putTool("put_roadmap", { roadmap: roadmap("video-owner-a", "shared-video") })
    const second = await putTool("put_roadmap", { roadmap: roadmap("video-owner-b", "shared-video") })
    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(409)
    expect(second.body.error).toContain("already belongs to course")
  })

  test("serializes concurrent video ownership checks", async () => {
    const results = await Promise.all([
      putTool("put_roadmap", { roadmap: roadmap("race-owner-a", "race-video") }),
      putTool("put_roadmap", { roadmap: roadmap("race-owner-b", "race-video") }),
    ])
    expect(results.map((result) => result.response.status).sort()).toEqual([200, 409])
  })

  test("invokes a tool through POST tools name", async () => {
    const result = await putTool("list_courses", {})
    expect(result.response.status).toBe(200)
    expect(result.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ courseId: "video-owner-a" }),
    ]))
  })

  test("rejects caller supplied outcome ids through MCP", async () => {
    const initialized = await mcp({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion, capabilities: {}, clientInfo: { name: "test", version: "0" } },
    })
    expect(initialized.response.status).toBe(200)
    const session = initialized.response.headers.get("mcp-session-id")!
    const headers = { "mcp-session-id": session, "mcp-protocol-version": protocolVersion }
    expect((await mcp({ jsonrpc: "2.0", method: "notifications/initialized" }, headers)).response.status).toBe(202)

    const result = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "append_outcome",
        arguments: {
          outcome: {
            type: "outcome",
            id: "caller-id",
            courseId: "mcp-id-course",
            questionId: "mcp-question",
            nodeId: "core-node",
            surface: "agent",
            status: "wrong",
          },
        },
      },
    }, headers)
    expect(result.response.status).toBe(200)
    expect(result.body.result.isError).toBe(true)
    expect(result.body.result.content[0].text).toContain("Expected no excess property")
  })

  test("computes ids and returns newly appended Grades during incremental ingest", async () => {
    const since = new Date(Date.now() - 1_000).toISOString()
    const appended = await putTool("append_outcome", {
      outcome: {
        type: "outcome",
        courseId: "agent-id-course",
        unitId: "first-unit",
        questionId: "agent-question",
        nodeId: "core-node",
        tier: "application",
        surface: "agent",
        status: "ungraded",
        text: "My explanation",
        answeredAt: "2020-01-01T00:00:00.000Z",
      },
    })
    expect(appended.response.status).toBe(200)
    expect(appended.body.id).toStartWith("outcome:agent-question:agent:")

    const graded = await putTool("append_grade", {
      courseId: "agent-id-course",
      grade: {
        type: "grade",
        outcomeId: appended.body.id,
        nodeId: "core-node",
        judgment: "partial",
        missing: "The explanation missed one consequence.",
      },
    })
    expect(graded.response.status).toBe(200)
    expect(graded.body.id).toBe(createGradeId(appended.body.id))

    const incremental = await putTool("get_outcomes", { courseId: "agent-id-course", since })
    expect(incremental.response.status).toBe(200)
    expect(incremental.body).toEqual([
      expect.objectContaining({
        type: "grade",
        outcomeId: appended.body.id,
        gradedAt: expect.any(String),
      }),
    ])
  })

  test("returns due reviews through the tool and HTTP endpoint", async () => {
    const course = roadmap("review-course", "review-video")
    const quizPlan: QuizPlan = {
      ...plan(course.courseId),
      questionPool: [
        question("question-1", "recall"),
        question("question-2", "application"),
        question("question-3", "application"),
      ],
    }
    const nodes: Nodes = [{
      id: "core-node",
      title: "Core node",
      summary: "A core node supports the rest.",
      dependsOn: [],
      taughtAt: [{ unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 1 } }],
    }]
    for (const [file, contents] of [
      [roadmapPath(root, course.courseId), serializeRoadmap(course)],
      [quizPlanPath(root, course.courseId, quizPlan.unitId), serializeQuizPlan(quizPlan)],
      [join(root, course.courseId, "nodes.json"), serializeNodes(nodes)],
    ] as const) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents, "utf8")
    }
    const answeredAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const appended = await request("/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "outcome",
        courseId: course.courseId,
        questionId: "question-2",
        nodeId: "core-node",
        tier: "application",
        surface: "agent",
        status: "correct",
        answeredAt,
      }),
    })
    expect(appended.response.status).toBe(200)

    const tool = await putTool("get_due_reviews", { courseId: course.courseId })
    expect(tool.response.status).toBe(200)
    expect(tool.body.reviews).toEqual([
      expect.objectContaining({
        courseId: course.courseId,
        node: expect.objectContaining({ id: "core-node" }),
        box: 1,
        dueAt: new Date(Date.parse(answeredAt) + 86_400_000).toISOString(),
        unitId: "first-unit",
        question: expect.objectContaining({ id: "question-3" }),
        poolExhausted: false,
      }),
    ])
    expect(tool.body.streak).toEqual(expect.objectContaining({
      currentStreak: expect.any(Number),
      todayCounts: expect.any(Boolean),
    }))

    const endpoint = await request(`/reviews/due?courseId=${course.courseId}`)
    expect(endpoint.response.status).toBe(200)
    expect(endpoint.body).toEqual(tool.body)
  })

  test("summarizes correct and wrong outcomes by tier", async () => {
    const course = roadmap("state-course", "state-video")
    const quizPlan = plan(course.courseId)
    const nodes: Nodes = [{
      id: "core-node",
      title: "Core node",
      summary: "A core node supports the rest.",
      dependsOn: [],
      taughtAt: [{ unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 1 } }],
    }]
    for (const [file, contents] of [
      [roadmapPath(root, course.courseId), serializeRoadmap(course)],
      [quizPlanPath(root, course.courseId, quizPlan.unitId), serializeQuizPlan(quizPlan)],
      [join(root, course.courseId, "nodes.json"), serializeNodes(nodes)],
    ] as const) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents, "utf8")
    }
    const outcomes = [
      ["question-1", "correct", "2026-03-20T10:00:00.000Z"],
      ["question-2", "wrong", "2026-03-20T11:00:00.000Z"],
      ["question-2", "correct", "2026-03-20T12:00:00.000Z"],
      ["question-1", "flagged", "2026-03-20T13:00:00.000Z"],
      ["question-2", "skipped", "2026-03-20T14:00:00.000Z"],
    ] as const
    for (const [questionId, status, answeredAt] of outcomes) {
      const result = await request("/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "outcome",
          courseId: course.courseId,
          unitId: "first-unit",
          questionId,
          nodeId: "core-node",
          surface: "agent",
          status,
          answeredAt,
        }),
      })
      expect(result.response.status).toBe(200)
    }
    for (const outcome of [
      {
        questionId: "ad-hoc-application",
        tier: "application",
        status: "correct",
        answeredAt: "2026-03-20T15:00:00.000Z",
      },
      {
        questionId: "ad-hoc-unknown-tier",
        status: "wrong",
        answeredAt: "2026-03-20T16:00:00.000Z",
      },
    ] as const) {
      const result = await request("/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "outcome",
          courseId: course.courseId,
          nodeId: "core-node",
          surface: "agent",
          ...outcome,
        }),
      })
      expect(result.response.status).toBe(200)
    }
    const ungradedAt = "2026-03-20T09:00:00.000Z"
    const ungraded = await request("/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "outcome",
        courseId: course.courseId,
        unitId: "first-unit",
        questionId: "question-2",
        nodeId: "core-node",
        surface: "agent",
        status: "ungraded",
        text: "An explanation",
        answeredAt: ungradedAt,
      }),
    })
    expect(ungraded.response.status).toBe(200)
    const grade = await putTool("append_grade", {
      courseId: course.courseId,
      grade: {
        type: "grade",
        outcomeId: ungraded.body.results[0].id,
        nodeId: "core-node",
        judgment: "understood",
        missing: "Nothing was missing.",
      },
    })
    expect(grade.response.status).toBe(200)
    const state = await putTool("get_course_state", { courseId: course.courseId })
    expect(state.response.status).toBe(200)
    expect(state.body.ungradedExplainBacks).toEqual([])
    expect(state.body.nodeSummaries[0]).toEqual({
      nodeId: "core-node",
      counts: {
        recall: { correct: 1, wrong: 0 },
        application: { correct: 2, wrong: 1 },
      },
      askCount: 0,
      latestAskAt: null,
      latestOutcomeAt: "2026-03-20T16:00:00.000Z",
      latestCorrectApplicationAt: "2026-03-20T15:00:00.000Z",
      latestWrongAt: "2026-03-20T16:00:00.000Z",
      box: 1,
      dueAt: "2026-03-21T11:00:00.000Z",
    })
  })
})
