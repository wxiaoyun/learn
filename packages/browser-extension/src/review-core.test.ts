import { describe, expect, test } from "bun:test"
import type { ChoiceQuestion } from "@learn/core"
import {
  createReviewSession,
  currentReview,
  recordReview,
  reviewSummary,
  scoreReview,
  type ReviewItem,
} from "./review-core"

const question = (id: string, correctIndex = 1): ChoiceQuestion => ({
  id,
  nodeId: `${id}-node`,
  tier: "application",
  kind: "choice",
  prompt: `${id}?`,
  options: ["no", "yes"],
  correctIndex,
  explanation: "Because.",
})

const review = (id: string, hasQuestion = true): ReviewItem => ({
  courseId: "demo-course",
  node: { id: `${id}-node`, title: id },
  question: hasQuestion ? question(id) : null,
})

describe("review session", () => {
  test("keeps due order and puts missing Questions last", () => {
    const session = createReviewSession([
      review("first"),
      review("missing", false),
      review("second"),
    ])
    expect(session.queue.map((item) => item.node.title)).toEqual(["first", "second", "missing"])
    expect(currentReview(session)?.node.title).toBe("first")
  })

  test("scores only the correct option as correct", () => {
    const asked = review("asked")
    expect(scoreReview(asked, 1)).toBe("correct")
    expect(scoreReview(asked, 0)).toBe("wrong")
    expect(scoreReview(asked)).toBe("wrong")
    expect(scoreReview(review("missing", false))).toBe("needs-questions")
  })

  test("summarizes a completed session", () => {
    let session = createReviewSession([
      review("right"),
      review("wrong"),
      review("skip"),
      review("flag"),
      review("missing", false),
    ])
    for (const result of ["correct", "wrong", "skipped", "flagged", "needs-questions"] as const) {
      session = recordReview(session, result)
    }
    expect(reviewSummary(session)).toEqual({ done: true, correct: 1, needsQuestions: 1 })
    expect(currentReview(session)).toBeUndefined()
  })
})
