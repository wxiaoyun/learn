import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendAsk, appendOutcome } from "./node"
import {
  createAnswerId,
  createAskId,
  createGradeId,
  createOutcomeId,
  parseAsks,
  parseNodes,
  parseOutcomes,
  parseQuizPlan,
  parseRoadmap,
  serializeAsk,
  serializeNodes,
  serializeOutcome,
  serializeQuizPlan,
  serializeRoadmap,
  type Answer,
  type Ask,
  type GradeOutcome,
  type Nodes,
  type Outcome,
  type PlainParseResult,
  type QuizPlan,
  type Roadmap,
} from "./schema"

function value<T>(result: PlainParseResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const roadmap: Roadmap = {
  courseId: "systems-course",
  title: "Systems",
  goal: "Understand a small system",
  sourceMaterials: [{ title: "Course playlist", reference: "https://example.com/playlist" }],
  units: [
    {
      id: "first-unit",
      kind: "youtube-video",
      title: "First unit",
      source: { videoId: "abc123", url: "https://www.youtube.com/watch?v=abc123" },
      order: 0,
      topics: ["foundations"],
      dependsOn: [],
    },
  ],
}

const nodes: Nodes = [
  {
    id: "core-node",
    title: "Core node",
    summary: "A core node supports the rest.",
    dependsOn: [],
    taughtAt: [{ unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 12 } }],
  },
]

const choice = (id: string, tier: "recall" | "application") => ({
  id,
  nodeId: "core-node",
  tier,
  kind: "choice" as const,
  prompt: `Prompt ${id}`,
  options: ["Correct", "Wrong"],
  correctIndex: 0,
  explanation: "Correct is correct.",
})

const quizPlan: QuizPlan = {
  courseId: "systems-course",
  unitId: "first-unit",
  nodeIds: ["core-node"],
  questionPool: [
    choice("question-1", "recall"),
    choice("question-2", "application"),
    choice("question-3", "recall"),
    choice("question-4", "application"),
    choice("question-5", "recall"),
    choice("question-6", "application"),
    {
      id: "explain-1",
      nodeId: "core-node",
      tier: "application",
      kind: "explain-back",
      prompt: "Explain the core node.",
      rubric: "The learner connects the node to its consequence.",
    },
  ],
  placements: [
    { kind: "pre-question", questionId: "question-1" },
    {
      kind: "pause",
      location: { unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 12 } },
      nodeIds: ["core-node"],
      questionIds: ["question-2", "question-3"],
    },
    {
      kind: "recap",
      questionIds: ["question-1", "question-2", "question-3", "question-4", "question-5"],
      explainBackQuestionId: "explain-1",
    },
  ],
}

const answeredAt = "2026-03-19T10:00:00.000Z"
const outcome: Outcome = {
  type: "outcome",
  id: createOutcomeId({ questionId: "question-1", surface: "youtube", answeredAt }),
  courseId: "systems-course",
  unitId: "first-unit",
  questionId: "question-1",
  nodeId: "core-node",
  surface: "youtube",
  status: "correct",
  chosenIndex: 0,
  answeredAt,
}

const tempPaths: string[] = []
afterAll(async () => {
  await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
})

describe("state validation", () => {
  test("rejects missing node dependencies and cycles", () => {
    const missing = parseNodes(JSON.stringify([
      { ...nodes[0], dependsOn: ["missing-node"] },
    ]))
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain("dependsOn")

    const cyclic = parseNodes(JSON.stringify([
      { ...nodes[0], id: "node-a", dependsOn: ["node-b"] },
      { ...nodes[0], id: "node-b", dependsOn: ["node-a"] },
    ]))
    expect(cyclic.ok).toBe(false)
    if (!cyclic.ok) expect(cyclic.error).toContain("cycle")
  })

  test("rejects quiz plan references to undeclared nodes", () => {
    const invalid = {
      ...quizPlan,
      questionPool: [{ ...quizPlan.questionPool[0], nodeId: "missing-node" }, ...quizPlan.questionPool.slice(1)],
    }
    const result = parseQuizPlan(JSON.stringify(invalid))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("nodeId")
  })

  test("accepts a matching pre-question location and rejects a different unit", () => {
    const placement = quizPlan.placements[0]
    if (placement?.kind !== "pre-question") throw new Error("fixture needs a pre-question")
    const valid = {
      ...quizPlan,
      placements: [
        { ...placement, location: { unitId: quizPlan.unitId, anchor: { kind: "video-timestamp" as const, seconds: 1 } } },
        ...quizPlan.placements.slice(1),
      ],
    }
    expect(parseQuizPlan(JSON.stringify(valid)).ok).toBe(true)
    const invalid = {
      ...valid,
      placements: [
        { ...valid.placements[0], location: { unitId: "other-unit", anchor: { kind: "video-timestamp", seconds: 1 } } },
        ...valid.placements.slice(1),
      ],
    }
    const result = parseQuizPlan(JSON.stringify(invalid))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("must match unitId")
  })

  test("rejects more than one recap quiz", () => {
    const recap = quizPlan.placements.find((placement) => placement.kind === "recap")
    if (!recap) throw new Error("fixture needs a recap quiz")
    const result = parseQuizPlan(JSON.stringify({
      ...quizPlan,
      placements: [...quizPlan.placements, recap],
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("at most one recap quiz")
  })

  test("rejects explain-back questions in pre-question and pause placements", () => {
    const placements = quizPlan.placements.map((placement) => {
      if (placement.kind === "pre-question") return { ...placement, questionId: "explain-1" }
      if (placement.kind === "pause") return { ...placement, questionIds: ["explain-1"] }
      return placement
    })
    const result = parseQuizPlan(JSON.stringify({ ...quizPlan, placements }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("must name a choice question")
  })

  test("accepts tiered outcomes and legacy outcomes without a tier", () => {
    const legacy = value(parseOutcomes(serializeOutcome(outcome)))
    const tiered: Outcome = { ...outcome, tier: "application" }
    expect(legacy[0]).not.toHaveProperty("tier")
    expect(value(parseOutcomes(serializeOutcome(tiered)))[0]).toEqual(tiered)
  })

  test("rejects impossible ISO date-times", () => {
    const answeredAt = "2026-99-99T99:99:99Z"
    const invalid = {
      ...outcome,
      answeredAt,
      id: createOutcomeId({ ...outcome, answeredAt }),
    }
    const result = parseOutcomes(`${JSON.stringify(invalid)}\n`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("valid ISO date-time")
  })

  test("round trips one valid fixture for every parsed file type", () => {
    expect(value(parseRoadmap(serializeRoadmap(roadmap)))).toEqual(roadmap)
    expect(value(parseNodes(serializeNodes(nodes)))).toEqual(nodes)
    expect(value(parseQuizPlan(serializeQuizPlan(quizPlan)))).toEqual(quizPlan)

    const grade: GradeOutcome = {
      type: "grade",
      id: createGradeId(outcome.id),
      outcomeId: outcome.id,
      nodeId: "core-node",
      judgment: "partial",
      missing: "The explanation missed the consequence.",
    }
    expect(value(parseOutcomes(serializeOutcome(outcome) + serializeOutcome(grade)))).toEqual([outcome, grade])
  })
})

describe("Ask identity and append", () => {
  test("round trips records and skips retried appends", async () => {
    const askedAt = "2026-03-21T10:00:00.000Z"
    const ask: Ask = {
      type: "ask",
      id: createAskId({ unitId: "first-unit", surface: "youtube", askedAt }),
      courseId: "systems-course",
      unitId: "first-unit",
      location: { unitId: "first-unit", anchor: { kind: "video-timestamp", seconds: 10 } },
      text: "How does this fit?",
      surface: "youtube",
      askedAt,
    }
    const answer: Answer = {
      type: "answer",
      id: createAnswerId(ask.id),
      askId: ask.id,
      text: "It fits through the core Node.",
      nodeIds: ["core-node"],
      answeredAt: "2026-03-21T10:00:01.000Z",
    }
    expect(value(parseAsks(serializeAsk(ask) + serializeAsk(answer)))).toEqual([ask, answer])
    const directory = await mkdtemp(join(tmpdir(), "learn-core-asks-"))
    tempPaths.push(directory)
    const file = join(directory, "asks.jsonl")
    expect(await appendAsk(file, ask)).toBe("appended")
    expect(await appendAsk(file, ask)).toBe("duplicate")
    expect(await appendAsk(file, answer)).toBe("appended")
    expect(await appendAsk(file, { ...answer, answeredAt: "2026-03-21T10:00:02.000Z" })).toBe("duplicate")
    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(2)
  })
})

describe("outcome identity and append", () => {
  test("uses deterministic ids and skips duplicate appends", async () => {
    expect(createOutcomeId(outcome)).toBe(outcome.id)
    expect(
      createOutcomeId({ ...outcome, answeredAt: "2026-03-19T10:01:00.000Z" }),
    ).not.toBe(outcome.id)
    expect(value(parseOutcomes(serializeOutcome(outcome)))).toEqual([outcome])

    const directory = await mkdtemp(join(tmpdir(), "learn-core-"))
    tempPaths.push(directory)
    const file = join(directory, "outcomes.jsonl")
    expect(await appendOutcome(file, outcome)).toBe("appended")
    expect(await appendOutcome(file, outcome)).toBe("duplicate")
    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(1)
  })
})
