import type { ChoiceQuestion } from "@learn/core"

export type ReviewItem = {
  courseId: string
  node: { id: string; title: string }
  question: ChoiceQuestion | null
}

export type ReviewResult = "correct" | "wrong" | "skipped" | "flagged" | "needs-questions"

export type ReviewSession = {
  queue: readonly ReviewItem[]
  results: readonly ReviewResult[]
}

export function createReviewSession(reviews: readonly ReviewItem[]): ReviewSession {
  return {
    queue: [
      ...reviews.filter((review) => review.question !== null),
      ...reviews.filter((review) => review.question === null),
    ],
    results: [],
  }
}

export function currentReview(session: ReviewSession): ReviewItem | undefined {
  return session.queue[session.results.length]
}

export function scoreReview(review: ReviewItem, chosenIndex?: number): ReviewResult {
  if (!review.question) return "needs-questions"
  return chosenIndex === review.question.correctIndex ? "correct" : "wrong"
}

export function recordReview(session: ReviewSession, result: ReviewResult): ReviewSession {
  if (!currentReview(session)) return session
  return { ...session, results: [...session.results, result] }
}

export function reviewSummary(session: ReviewSession): {
  done: boolean
  correct: number
  needsQuestions: number
} {
  return {
    done: session.results.length === session.queue.length,
    correct: session.results.filter((result) => result === "correct").length,
    needsQuestions: session.results.filter((result) => result === "needs-questions").length,
  }
}
