import { describe, expect, test } from "bun:test"
import type { Placement, QuizPlan, Question } from "@learn/core"
import { landedNodeIds, playbackStep, recapQuestionIds, type PlacementOutcome } from "./playback-core"

const location = (seconds: number) => ({
  unitId: "demo-unit",
  anchor: { kind: "video-timestamp" as const, seconds },
})
const pause = (seconds: number, ...ids: string[]): Placement => ({
  kind: "pause",
  location: location(seconds),
  nodeIds: ["demo-node"],
  questionIds: ids,
})
const choice = (id: string, nodeId = "demo-node", tier: "recall" | "application" = "recall"): Question => ({
  id,
  nodeId,
  tier,
  kind: "choice",
  prompt: id,
  options: ["a", "b"],
  correctIndex: 0,
  explanation: "Because.",
})
const plan = (placements: Placement[], ids: string[]): QuizPlan => ({
  courseId: "demo-course",
  unitId: "demo-unit",
  nodeIds: ["demo-node"],
  questionPool: [
    ...ids.map((id) => choice(id)),
    { id: "explain", nodeId: "demo-node", tier: "application", kind: "explain-back", prompt: "Explain.", rubric: "Clear." },
  ],
  placements,
})
const step = (
  placements: Placement[],
  previousTime: number,
  currentTime: number,
  options: {
    playbackRate?: number
    seeking?: boolean
    answeredPlacements?: string[]
    sessionOutcomes?: PlacementOutcome[]
  } = {},
) => playbackStep({
  placements,
  previousTime,
  currentTime,
  playbackRate: options.playbackRate ?? 1,
  seeking: options.seeking ?? false,
  answeredPlacementKeys: new Set(options.answeredPlacements),
  sessionOutcomes: options.sessionOutcomes ?? [],
})

describe("playback state", () => {
  test("normal crossing triggers once", () => {
    const placements = [pause(10, "q1")]
    expect(step(placements, 9, 10.1).trigger?.questionIds).toEqual(["q1"])
    expect(step(placements, 10.1, 10.2).trigger).toBeUndefined()
  })

  test("seek over three placements triggers nothing and reports three", () => {
    const result = step([pause(10, "q1"), pause(20, "q2"), pause(30, "q3")], 1, 40, { seeking: true })
    expect(result.trigger).toBeUndefined()
    expect(result.passed.map((placement) => placement.seconds)).toEqual([10, 20, 30])
    expect(step([pause(10, "q1"), pause(20, "q2"), pause(30, "q3")], 1, 40, {
      seeking: true,
      answeredPlacements: ["pause:20"],
    }).passed.map((placement) => placement.seconds)).toEqual([10, 30])
  })

  test("answered through replacements never retriggers on rewatch", () => {
    const placements = [pause(10, "q1", "q2")]
    const sessionOutcomes: PlacementOutcome[] = [
      { placementKey: "pause:10", questionId: "q5", status: "correct" },
      { placementKey: "pause:10", questionId: "q6", status: "wrong" },
    ]
    expect(step(placements, 9, 11, { sessionOutcomes }).trigger).toBeUndefined()
    expect(step(placements, 0, 11, { sessionOutcomes }).trigger).toBeUndefined()
  })

  test("flagged completes a placement while skipped does not", () => {
    const placements = [pause(10, "q1")]
    expect(step(placements, 9, 11, {
      sessionOutcomes: [{ placementKey: "pause:10", questionId: "q5", status: "flagged" }],
    }).trigger).toBeUndefined()
    expect(step(placements, 9, 11, {
      sessionOutcomes: [{ placementKey: "pause:10", questionId: "q5", status: "skipped" }],
    }).trigger).toBeDefined()
  })

  test("2x playback still triggers", () => {
    expect(step([pause(10, "q1")], 9, 10.5, { playbackRate: 2 }).trigger?.seconds).toBe(10)
  })

  test("recap puts unanswered and missed first and caps choices at eight", () => {
    const quizPlan = plan([
      { kind: "pre-question", questionId: "q1", location: location(2) },
      pause(10, "q2"),
      { kind: "recap", questionIds: ["q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"], explainBackQuestionId: "explain" },
    ], ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"])
    const recap = recapQuestionIds({
      plan: quizPlan,
      answeredQuestionIds: new Set(["q1"]),
      answeredPlacementKeys: new Set(["pre-question:2"]),
      sessionOutcomes: [],
      missedQuestionIds: new Set(["q1"]),
    })
    expect(recap.choiceQuestionIds).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"])
    expect(recap.explainBackQuestionId).toBe("explain")
  })

  test("skipped stays unanswered", () => {
    const quizPlan = plan([
      pause(10, "q1"),
      { kind: "recap", questionIds: ["q2", "q3", "q4", "q5", "q6"], explainBackQuestionId: "explain" },
    ], ["q1", "q2", "q3", "q4", "q5", "q6"])
    const recap = recapQuestionIds({
      plan: quizPlan,
      answeredQuestionIds: new Set(),
      answeredPlacementKeys: new Set(),
      sessionOutcomes: [],
      missedQuestionIds: new Set(["q1"]),
    })
    expect(recap.choiceQuestionIds[0]).toBe("q1")
    expect(step([pause(10, "q1")], 9, 11).trigger).toBeDefined()
  })

  test("only correct application Questions land their Nodes", () => {
    const base = plan([], ["recall"])
    const quizPlan: QuizPlan = {
      ...base,
      questionPool: [...base.questionPool, choice("application", "demo-node", "application")],
    }
    expect([...landedNodeIds(quizPlan, new Set(["recall"]))]).toEqual([])
    expect([...landedNodeIds(quizPlan, new Set(["application"]))]).toEqual(["demo-node"])
  })
})
