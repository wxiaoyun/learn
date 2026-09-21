import { describe, expect, test } from "bun:test"
import {
  createGradeId,
  createOutcomeId,
  deriveDailyStreak,
  deriveReviewStates,
  placementKey,
  placementQuestions,
  selectReviewQuestion,
  type GradeOutcome,
  type Outcome,
  type OutcomeRecord,
  type Placement,
  type Question,
} from "./schema"

const choice = (
  id: string,
  nodeId: string,
  tier: "recall" | "application",
): Question => ({
  id,
  nodeId,
  tier,
  kind: "choice",
  prompt: id,
  options: ["Correct", "Wrong"],
  correctIndex: 0,
  explanation: "Correct is correct.",
})

const outcome = (
  questionId: string,
  nodeId: string,
  tier: "recall" | "application",
  status: Outcome["status"],
  answeredAt: string,
): Outcome => ({
  type: "outcome",
  id: createOutcomeId({ questionId, surface: "agent", answeredAt }),
  courseId: "review-course",
  questionId,
  nodeId,
  tier,
  surface: "agent",
  status,
  answeredAt,
})

const pause = (questionIds: string[], nodeIds = ["node-a"]): Placement => ({
  kind: "pause",
  location: { unitId: "unit-one", anchor: { kind: "video-timestamp", seconds: 10 } },
  nodeIds,
  questionIds,
})

describe("placement identity", () => {
  test("derives stable keys from kind and location", () => {
    expect(placementKey({
      kind: "pause",
      location: { unitId: "unit-one", anchor: { kind: "video-timestamp", seconds: 420 } },
      nodeIds: ["node-a"],
      questionIds: ["q1"],
    })).toBe("pause:420")
    expect(placementKey({
      kind: "pre-question",
      questionId: "q1",
      location: { unitId: "unit-one", anchor: { kind: "page", page: 12 } },
    })).toBe("pre-question:page:12")
    expect(placementKey({ kind: "pre-question", questionId: "q1" })).toBe("pre-question:q1")
    expect(placementKey({ kind: "recap", questionIds: ["q1", "q2", "q3", "q4", "q5"], explainBackQuestionId: "explain" })).toBe("recap")
  })
})

describe("placement questions", () => {
  test("returns the authored choice Questions in order and never an Explain-back", () => {
    const pool = [
      choice("a-recall", "node-a", "recall"),
      choice("a-application", "node-a", "application"),
      {
        id: "a-explain",
        nodeId: "node-a",
        tier: "application" as const,
        kind: "explain-back" as const,
        prompt: "Explain node A.",
        rubric: "Explain node A clearly.",
      },
    ]
    expect(placementQuestions(pause(["a-application", "a-explain", "a-recall"]), pool).map((question) => question.id))
      .toEqual(["a-application", "a-recall"])
    expect(placementQuestions({ kind: "pre-question", questionId: "a-recall" }, pool).map((question) => question.id))
      .toEqual(["a-recall"])
  })
})

describe("Spaced review", () => {
  test("progresses through 1, 3, 7, and 21 day intervals", () => {
    const records = [
      outcome("q1", "node-a", "application", "correct", "2026-01-01T09:00:00.000Z"),
      outcome("q2", "node-a", "application", "correct", "2026-01-02T09:00:00.000Z"),
      outcome("q3", "node-a", "application", "correct", "2026-01-05T09:00:00.000Z"),
      outcome("q4", "node-a", "application", "correct", "2026-01-12T09:00:00.000Z"),
      outcome("q5", "node-a", "application", "correct", "2026-02-02T09:00:00.000Z"),
    ]
    expect(deriveReviewStates(records.slice(0, 1), "2026-01-01T10:00:00.000Z")[0]).toMatchObject({ box: 1, dueAt: "2026-01-02T09:00:00.000Z" })
    expect(deriveReviewStates(records.slice(0, 2), "2026-01-02T10:00:00.000Z")[0]).toMatchObject({ box: 2, dueAt: "2026-01-05T09:00:00.000Z" })
    expect(deriveReviewStates(records.slice(0, 3), "2026-01-05T10:00:00.000Z")[0]).toMatchObject({ box: 3, dueAt: "2026-01-12T09:00:00.000Z" })
    expect(deriveReviewStates(records.slice(0, 4), "2026-01-12T10:00:00.000Z")[0]).toMatchObject({ box: 4, dueAt: "2026-02-02T09:00:00.000Z" })
    expect(deriveReviewStates(records, "2026-02-02T10:00:00.000Z")[0]).toEqual({
      nodeId: "node-a",
      box: 4,
      dueAt: "2026-02-23T09:00:00.000Z",
      lastReviewedAt: "2026-02-02T09:00:00.000Z",
    })
  })

  test("ignores an early correct application Outcome", () => {
    const records = [
      outcome("q1", "node-a", "application", "correct", "2026-01-01T09:00:00.000Z"),
      outcome("q2", "node-a", "application", "correct", "2026-01-01T12:00:00.000Z"),
    ]
    expect(deriveReviewStates(records, "2026-01-01T13:00:00.000Z")[0]).toEqual({
      nodeId: "node-a",
      box: 1,
      dueAt: "2026-01-02T09:00:00.000Z",
      lastReviewedAt: "2026-01-01T09:00:00.000Z",
    })
  })

  test("resets to box one after a wrong application Outcome", () => {
    const records = [
      outcome("q1", "node-a", "application", "correct", "2026-01-01T09:00:00.000Z"),
      outcome("q2", "node-a", "application", "correct", "2026-01-02T09:00:00.000Z"),
      outcome("q3", "node-a", "application", "wrong", "2026-01-03T09:00:00.000Z"),
    ]
    expect(deriveReviewStates(records, "2026-01-03T10:00:00.000Z")[0]).toMatchObject({
      box: 1,
      dueAt: "2026-01-04T09:00:00.000Z",
      lastReviewedAt: "2026-01-03T09:00:00.000Z",
    })
  })

  test("never moves a box from recall Tier evidence", () => {
    const records = [
      outcome("q1", "node-a", "application", "correct", "2026-01-01T09:00:00.000Z"),
      outcome("q2", "node-a", "recall", "wrong", "2026-01-02T09:00:00.000Z"),
      outcome("q3", "node-a", "recall", "correct", "2026-01-03T09:00:00.000Z"),
    ]
    expect(deriveReviewStates(records, "2026-01-03T10:00:00.000Z")[0]).toMatchObject({ box: 1, dueAt: "2026-01-02T09:00:00.000Z" })
  })

  test("counts an application Explain-back graded understood", () => {
    const answer = outcome("explain", "node-a", "application", "ungraded", "2026-01-01T09:00:00.000Z")
    const grade: GradeOutcome = {
      type: "grade",
      id: createGradeId(answer.id),
      outcomeId: answer.id,
      nodeId: "node-a",
      judgment: "understood",
      missing: "Nothing was missing.",
      gradedAt: "2026-01-01T10:00:00.000Z",
    }
    expect(deriveReviewStates([answer, grade], "2026-01-01T11:00:00.000Z")[0]).toMatchObject({
      box: 1,
      dueAt: "2026-01-02T09:00:00.000Z",
    })
  })

  test("derives consecutive and broken daily streaks in the given timezone", () => {
    const consecutive = [
      outcome("q1", "node-a", "application", "correct", "2026-01-01T20:00:00.000Z"),
      outcome("q2", "node-b", "application", "correct", "2026-01-02T20:00:00.000Z"),
      outcome("q3", "node-c", "application", "correct", "2026-01-03T20:00:00.000Z"),
    ]
    expect(deriveDailyStreak(consecutive, "2026-01-03T23:00:00.000Z", "UTC")).toEqual({ currentStreak: 3, todayCounts: true })
    expect(deriveDailyStreak(consecutive, "2026-01-04T12:00:00.000Z", "UTC")).toEqual({ currentStreak: 3, todayCounts: false })
    const broken = [...consecutive, outcome("q4", "node-d", "application", "correct", "2026-01-05T20:00:00.000Z")]
    expect(deriveDailyStreak(broken, "2026-01-05T23:00:00.000Z", "UTC")).toEqual({ currentStreak: 1, todayCounts: true })

    const sameNodeAcrossCourses = [
      { ...outcome("q5", "shared-node", "application", "correct", "2026-01-01T20:00:00.000Z"), courseId: "course-a" },
      { ...outcome("q6", "shared-node", "application", "correct", "2026-01-02T10:00:00.000Z"), courseId: "course-b" },
    ]
    expect(deriveDailyStreak(sameNodeAcrossCourses, "2026-01-02T12:00:00.000Z", "UTC")).toEqual({ currentStreak: 2, todayCounts: true })
  })

  test("picks an unanswered application choice, then the least recently answered one", () => {
    const pool = [
      choice("recall", "node-a", "recall"),
      choice("app-one", "node-a", "application"),
      choice("app-two", "node-a", "application"),
    ]
    const unanswered = selectReviewQuestion({
      nodeId: "node-a",
      questionPool: pool,
      outcomes: [outcome("app-one", "node-a", "application", "correct", "2026-01-01T09:00:00.000Z")],
    })
    expect(unanswered.question?.id).toBe("app-two")
    expect(unanswered.poolExhausted).toBe(false)

    const exhausted = selectReviewQuestion({
      nodeId: "node-a",
      questionPool: pool,
      outcomes: [
        outcome("app-one", "node-a", "application", "correct", "2026-01-01T09:00:00.000Z"),
        outcome("app-two", "node-a", "application", "wrong", "2026-01-02T09:00:00.000Z"),
      ],
    })
    expect(exhausted.question?.id).toBe("app-one")
    expect(exhausted.poolExhausted).toBe(true)
  })

  test("reports pool exhaustion when no application choice exists", () => {
    expect(selectReviewQuestion({
      nodeId: "node-a",
      questionPool: [choice("recall", "node-a", "recall")],
      outcomes: [],
    })).toEqual({ poolExhausted: true })
  })
})
