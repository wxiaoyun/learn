import type { ChoiceQuestion, ClientLogLine, OutcomeInput } from "@learn/core"
import katex from "katex"
import {
  createReviewSession,
  currentReview,
  recordReview,
  reviewSummary,
  scoreReview,
  type ReviewItem,
  type ReviewResult,
  type ReviewSession,
} from "./review-core"

type ServerReply = { ok: boolean; status: number; data?: unknown; error?: string }
type Streak = { currentStreak: number; todayCounts: boolean }
type DueReply = { reviews: ReviewItem[]; streak: Streak }

const app = document.querySelector<HTMLElement>("#app")!
let session: ReviewSession = createReviewSession([])
let streak: Streak = { currentStreak: 0, todayCounts: false }
let enterAction: (() => void) | undefined
let skipAction: (() => void) | undefined

async function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function log(line: ClientLogLine): void {
  void send({ type: "log", line }).catch(() => undefined)
}

function button(label: string, action: () => void, className = ""): HTMLButtonElement {
  const element = document.createElement("button")
  element.type = "button"
  element.className = className
  element.textContent = label
  element.addEventListener("click", action)
  return element
}

// ponytail: duplicated from content.ts to avoid changing the untested YouTube overlay. Share after Chrome verification.
function renderText(element: HTMLElement, text: string): void {
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    element.append(document.createTextNode(text.slice(offset, index)))
    const token = match[0]
    const displayMode = token.startsWith("$$")
    const math = token.slice(displayMode ? 2 : 1, displayMode ? -2 : -1)
    const span = document.createElement(displayMode ? "div" : "span")
    try {
      katex.render(math, span, { displayMode, throwOnError: true, trust: false })
      element.append(span)
    } catch {
      element.append(document.createTextNode(token))
    }
    offset = index + token.length
  }
  element.append(document.createTextNode(text.slice(offset)))
}

function decodeQuestion(value: unknown): ChoiceQuestion | undefined {
  if (!value || typeof value !== "object") return undefined
  const question = value as Record<string, unknown>
  if (question.kind !== "choice"
    || typeof question.id !== "string"
    || typeof question.nodeId !== "string"
    || (question.tier !== "recall" && question.tier !== "application")
    || typeof question.prompt !== "string"
    || !Array.isArray(question.options)
    || question.options.length < 2
    || !question.options.every((option) => typeof option === "string")
    || !Number.isInteger(question.correctIndex)
    || Number(question.correctIndex) < 0
    || Number(question.correctIndex) >= question.options.length
    || typeof question.explanation !== "string") return undefined
  return {
    id: question.id,
    nodeId: question.nodeId,
    tier: question.tier,
    kind: "choice",
    prompt: question.prompt,
    options: question.options as string[],
    correctIndex: Number(question.correctIndex),
    explanation: question.explanation,
  }
}

function decodeStreak(value: unknown): Streak | undefined {
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Record<string, unknown>
  return Number.isInteger(candidate.currentStreak)
    && Number(candidate.currentStreak) >= 0
    && typeof candidate.todayCounts === "boolean"
    ? { currentStreak: Number(candidate.currentStreak), todayCounts: candidate.todayCounts }
    : undefined
}

function decodeDue(value: unknown): DueReply | undefined {
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Record<string, unknown>
  const decodedStreak = decodeStreak(candidate.streak)
  if (!Array.isArray(candidate.reviews) || !decodedStreak) return undefined
  const reviews: ReviewItem[] = []
  for (const value of candidate.reviews) {
    if (!value || typeof value !== "object") return undefined
    const review = value as Record<string, unknown>
    if (typeof review.courseId !== "string"
      || !review.node
      || typeof review.node !== "object"
      || typeof (review.node as Record<string, unknown>).id !== "string"
      || typeof (review.node as Record<string, unknown>).title !== "string"
      || typeof review.poolExhausted !== "boolean") return undefined
    const node = review.node as { id: string; title: string }
    const question = review.question === null ? null : decodeQuestion(review.question)
    if (question === undefined || (question && question.nodeId !== node.id)) return undefined
    reviews.push({ courseId: review.courseId, node, question })
  }
  return { reviews, streak: decodedStreak }
}

function streakLine(value: Streak): HTMLParagraphElement {
  const line = document.createElement("p")
  line.className = "streak"
  line.textContent = `streak: ${value.currentStreak} ${value.currentStreak === 1 ? "day" : "days"}`
  return line
}

function showPageFailure(message: string, retry: () => void): void {
  enterAction = undefined
  skipAction = undefined
  const text = document.createElement("p")
  text.className = "failure-message"
  text.setAttribute("role", "alert")
  text.textContent = message
  const retryButton = button("Retry", retry, "primary")
  app.replaceChildren(text, retryButton)
  enterAction = () => retryButton.click()
  retryButton.focus()
}

function failureMessage(response: ServerReply, fallback: string): string {
  return response.status === 0 ? "learning server unreachable, is your Mac on?" : fallback
}

function showInlineFailure(container: HTMLElement, message: string, retry: () => void): void {
  container.querySelector(".failure")?.remove()
  const failure = document.createElement("div")
  failure.className = "failure"
  const text = document.createElement("p")
  text.setAttribute("role", "alert")
  text.textContent = message
  const retryButton = button("Retry", retry, "primary")
  failure.append(text, retryButton)
  container.append(failure)
  enterAction = () => retryButton.click()
  retryButton.focus()
}

async function saveOutcome(
  container: HTMLElement,
  outcome: OutcomeInput,
  saved: () => void,
): Promise<void> {
  container.querySelector(".failure")?.remove()
  enterAction = undefined
  const retry = () => void saveOutcome(container, outcome, saved)
  let response: ServerReply
  try {
    response = await send<ServerReply>({ type: "reviewOutcome", outcome })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log({ level: "error", stage: "save_review_outcome", target: "/outcomes", status: "failed", error: message })
    showInlineFailure(container, "learning server unreachable, is your Mac on?", retry)
    return
  }
  if (!response.ok) {
    showInlineFailure(container, failureMessage(response, "could not save this Outcome"), retry)
    return
  }
  saved()
}

function outcome(
  review: ReviewItem,
  status: OutcomeInput["status"],
  chosenIndex?: number,
): OutcomeInput {
  if (!review.question) throw new Error("review Question is missing")
  return {
    type: "outcome",
    courseId: review.courseId,
    questionId: review.question.id,
    nodeId: review.node.id,
    tier: review.question.tier,
    surface: "browser",
    status,
    answeredAt: new Date().toISOString(),
    ...(chosenIndex !== undefined && { chosenIndex }),
  }
}

function questionHeader(review: ReviewItem): [HTMLHeadingElement, HTMLDivElement] {
  const title = document.createElement("h1")
  title.textContent = review.node.title
  const prompt = document.createElement("div")
  prompt.className = "prompt"
  renderText(prompt, review.question?.prompt ?? "")
  return [title, prompt]
}

function lock(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>("button").forEach((item) => { item.disabled = true })
  enterAction = undefined
  skipAction = undefined
}

function advance(result: ReviewResult): void {
  session = recordReview(session, result)
  renderCurrent()
}

function showFlagged(review: ReviewItem): void {
  const card = document.createElement("section")
  card.className = "card"
  const [title, prompt] = questionHeader(review)
  const feedback = document.createElement("p")
  feedback.className = "feedback"
  feedback.setAttribute("role", "status")
  feedback.textContent = "Question flagged."
  card.append(title, prompt, feedback)
  app.replaceChildren(card)
  void saveOutcome(card, outcome(review, "flagged"), () => {
    const actions = document.createElement("div")
    actions.className = "actions"
    const next = button("Continue", () => advance("flagged"), "primary")
    actions.append(next)
    card.append(actions)
    enterAction = () => next.click()
    next.focus()
  })
}

function showAnswer(review: ReviewItem, chosenIndex: number): void {
  const result = scoreReview(review, chosenIndex)
  if (result !== "correct" && result !== "wrong") return
  const card = document.createElement("section")
  card.className = "card"
  const [title, prompt] = questionHeader(review)
  const feedback = document.createElement("p")
  feedback.className = `feedback ${result}`
  feedback.setAttribute("role", "status")
  feedback.textContent = result === "correct" ? "Right" : "Wrong"
  const correct = document.createElement("div")
  correct.className = "correct-answer"
  renderText(correct, `Correct answer: ${review.question!.options[review.question!.correctIndex]}`)
  const explanation = document.createElement("div")
  explanation.className = "explanation"
  renderText(explanation, review.question!.explanation)
  card.append(title, prompt, feedback, correct, explanation)
  app.replaceChildren(card)
  void saveOutcome(card, outcome(review, result, chosenIndex), () => {
    const actions = document.createElement("div")
    actions.className = "actions"
    const flag = button("Flag", () => {
      flag.disabled = true
      next.disabled = true
      const flagged = outcome(review, "flagged")
      void saveOutcome(card, flagged, () => {
        flag.textContent = "Flagged"
        next.disabled = false
        enterAction = () => next.click()
        next.focus()
      })
    })
    const next = button("Continue", () => advance(result), "primary")
    actions.append(flag, next)
    card.append(actions)
    enterAction = () => next.click()
    next.focus()
  })
}

function showQuestion(review: ReviewItem): void {
  const question = review.question!
  let selectedIndex: number | undefined
  const card = document.createElement("section")
  card.className = "card"
  const [title, prompt] = questionHeader(review)
  const options = document.createElement("div")
  options.className = "options"
  options.setAttribute("role", "radiogroup")
  const optionButtons = question.options.map((option, index) => {
    const optionButton = button("", () => select(index))
    optionButton.setAttribute("role", "radio")
    optionButton.setAttribute("aria-checked", "false")
    renderText(optionButton, `${index + 1}. ${option}`)
    options.append(optionButton)
    return optionButton
  })
  const actions = document.createElement("div")
  actions.className = "actions"
  const confirm = button("Confirm", () => {
    if (selectedIndex === undefined) return
    lock(card)
    showAnswer(review, selectedIndex)
  }, "primary")
  confirm.disabled = true
  const flag = button("Flag", () => {
    lock(card)
    showFlagged(review)
  })
  const skip = button("Skip", () => {
    lock(card)
    void saveOutcome(card, outcome(review, "skipped"), () => advance("skipped"))
  })
  const select = (index: number): void => {
    selectedIndex = index
    optionButtons.forEach((optionButton, optionIndex) => {
      optionButton.classList.toggle("selected", optionIndex === index)
      optionButton.setAttribute("aria-checked", String(optionIndex === index))
    })
    confirm.disabled = false
    confirm.focus()
  }
  actions.append(flag, skip, confirm)
  card.append(title, prompt, options, actions)
  app.replaceChildren(card)
  enterAction = () => confirm.click()
  skipAction = () => skip.click()
  optionButtons[0]?.focus()
}

function showMissing(review: ReviewItem): void {
  const card = document.createElement("section")
  card.className = "card"
  const title = document.createElement("h1")
  title.textContent = review.node.title
  const message = document.createElement("p")
  message.textContent = "needs new questions, visit the agent"
  const next = button("Continue", () => advance(scoreReview(review)), "primary")
  card.append(title, message, next)
  app.replaceChildren(card)
  enterAction = () => next.click()
  skipAction = undefined
  next.focus()
}

function showEmpty(): void {
  enterAction = undefined
  skipAction = undefined
  const title = document.createElement("h1")
  title.textContent = "nothing due"
  app.replaceChildren(title, streakLine(streak))
}

async function showEnd(): Promise<void> {
  enterAction = undefined
  skipAction = undefined
  const loading = document.createElement("p")
  loading.textContent = "Loading..."
  app.replaceChildren(loading)
  let response: ServerReply
  try {
    response = await send<ServerReply>({ type: "reviewStreak" })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log({ level: "error", stage: "refresh_review_streak", target: "/reviews/due", status: "failed", error: message })
    showPageFailure("learning server unreachable, is your Mac on?", () => void showEnd())
    return
  }
  const value = response.ok && response.data && typeof response.data === "object"
    ? decodeStreak((response.data as Record<string, unknown>).streak)
    : undefined
  if (!response.ok || !value) {
    if (response.ok) log({ level: "error", stage: "decode_review_streak", target: "/reviews/due", status: "failed", error: "invalid server response" })
    showPageFailure(failureMessage(response, "could not refresh the streak"), () => void showEnd())
    return
  }
  streak = value
  const summary = reviewSummary(session)
  const correct = document.createElement("h1")
  correct.textContent = `${summary.correct} correct`
  app.replaceChildren(correct, streakLine(streak))
}

function renderCurrent(): void {
  const summary = reviewSummary(session)
  if (summary.done) {
    void showEnd()
    return
  }
  const review = currentReview(session)!
  if (review.question) showQuestion(review)
  else showMissing(review)
}

async function loadDue(): Promise<void> {
  enterAction = undefined
  skipAction = undefined
  const loading = document.createElement("p")
  loading.textContent = "Loading..."
  app.replaceChildren(loading)
  let response: ServerReply
  try {
    response = await send<ServerReply>({ type: "reviewDue" })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log({ level: "error", stage: "load_due_reviews", target: "/reviews/due", status: "failed", error: message })
    showPageFailure("learning server unreachable, is your Mac on?", () => void loadDue())
    return
  }
  if (!response.ok) {
    showPageFailure(failureMessage(response, "could not load due reviews"), () => void loadDue())
    return
  }
  const decoded = decodeDue(response.data)
  if (!decoded) {
    log({ level: "error", stage: "decode_due_reviews", target: "/reviews/due", status: "failed", error: "invalid server response" })
    showPageFailure("learning server returned invalid due reviews", () => void loadDue())
    return
  }
  streak = decoded.streak
  session = createReviewSession(decoded.reviews)
  if (session.queue.length === 0) showEmpty()
  else renderCurrent()
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && skipAction) {
    event.preventDefault()
    skipAction()
    return
  }
  if (/^[1-9]$/.test(event.key)) {
    const options = [...app.querySelectorAll<HTMLButtonElement>(".options button:not([disabled])")]
    const option = options[Number(event.key) - 1]
    if (option) {
      event.preventDefault()
      option.click()
    }
    return
  }
  if (event.key === "Enter" && enterAction) {
    event.preventDefault()
    enterAction()
  }
})

void loadDue()
