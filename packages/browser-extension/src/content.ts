import { parseQuizPlan, placementKey, selectQuestions, type ChoiceQuestion, type ClientLogLine, type GradedResult, type OutcomeInput, type Question, type QuizPlan } from "@learn/core"
import katex from "katex"
import { completedPlacementKeys, landedNodeIds, playbackStep, recapQuestionIds, timedPlacements, type PlacementOutcome } from "./playback-core"

type ServerReply = { ok: boolean; status: number; data?: unknown; error?: string }
type PlanReply = {
  courseId: string
  unitId: string
  plan: QuizPlan
  answeredQuestionIds: string[]
  answeredPlacementKeys: string[]
  correctQuestionIds: string[]
  wrongQuestionIds: string[]
  recentGradedResults: GradedResult[]
}
type QueuedQuestion = { id: string; placementIndex: number; placementKey: string; recap: boolean }

const HOST_ID = "learning-youtube-surface"
const style = `
  :host { all: initial; color-scheme: light dark; font-family: system-ui, sans-serif; }
  * { box-sizing: border-box; }
  .backdrop { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / 64%); pointer-events: auto; }
  .dialog { width: min(680px, 100%); max-height: min(82vh, 760px); overflow: auto; border: 1px solid #52525b; border-radius: 14px; padding: 24px; color: #18181b; background: #fff; box-shadow: 0 18px 60px rgb(0 0 0 / 45%); font: 16px/1.5 system-ui, sans-serif; }
  h2 { margin: 0 0 16px; font-size: 22px; }
  .prompt, .explanation, .correct { margin: 14px 0; white-space: pre-wrap; }
  .options { display: grid; gap: 9px; margin: 16px 0; }
  button { border: 1px solid #71717a; border-radius: 8px; padding: 10px 13px; color: inherit; background: #f4f4f5; font: inherit; text-align: left; cursor: pointer; }
  button:hover { background: #e4e4e7; }
  button:focus-visible, textarea:focus-visible { outline: 3px solid #60a5fa; outline-offset: 2px; }
  button.selected { border-color: #2563eb; background: #dbeafe; }
  button.primary { border-color: #1d4ed8; color: #fff; background: #2563eb; font-weight: 650; text-align: center; }
  button.primary:hover { background: #1d4ed8; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; }
  .feedback { border-left: 5px solid #16a34a; padding-left: 12px; font-weight: 700; }
  .feedback.wrong { border-color: #dc2626; }
  textarea { width: 100%; min-height: 150px; resize: vertical; border: 1px solid #71717a; border-radius: 8px; padding: 10px; color: inherit; background: #fff; font: inherit; }
  .hint { color: #52525b; font-size: 13px; }
  .toast { position: fixed; z-index: 2147483647; right: 20px; bottom: 24px; max-width: min(460px, calc(100vw - 40px)); border-radius: 9px; padding: 12px 15px; color: #fff; background: #27272a; box-shadow: 0 5px 20px rgb(0 0 0 / 40%); font: 14px/1.4 system-ui, sans-serif; pointer-events: auto; }
  .reward { position: fixed; z-index: 2147483645; top: 72px; right: 18px; width: 190px; border-radius: 9px; padding: 10px 12px; color: #fff; background: rgb(24 24 27 / 92%); box-shadow: 0 3px 14px rgb(0 0 0 / 35%); font: 13px/1.3 system-ui, sans-serif; pointer-events: none; }
  .track { height: 6px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: #52525b; }
  .fill { height: 100%; background: #22c55e; }
  @media (prefers-color-scheme: dark) {
    .dialog { color: #fafafa; background: #18181b; }
    button { background: #27272a; }
    button:hover { background: #3f3f46; }
    button.selected { border-color: #60a5fa; background: #1e3a5f; }
    textarea { background: #27272a; }
    .hint { color: #d4d4d8; }
  }
`

function makeSurface(): { host: HTMLElement; root: ShadowRoot } {
  document.getElementById(HOST_ID)?.remove()
  const host = document.createElement("div")
  host.id = HOST_ID
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483645;pointer-events:none"
  const root = host.attachShadow({ mode: "open" })
  const sheet = document.createElement("style")
  sheet.textContent = style
  const katexSheet = document.createElement("link")
  katexSheet.rel = "stylesheet"
  katexSheet.href = chrome.runtime.getURL("katex.min.css")
  root.append(sheet, katexSheet)
  document.documentElement.append(host)
  return { host, root }
}

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

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

async function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function log(videoId: string, line: ClientLogLine): void {
  void send({ type: "log", videoId, line }).catch(() => undefined)
}

function decodePlan(data: unknown): PlanReply | undefined {
  if (!data || typeof data !== "object") return undefined
  const value = data as Record<string, unknown>
  if (typeof value.courseId !== "string" || typeof value.unitId !== "string") return undefined
  if (!Array.isArray(value.answeredQuestionIds) || !value.answeredQuestionIds.every((id) => typeof id === "string")) return undefined
  if (!Array.isArray(value.answeredPlacementKeys) || !value.answeredPlacementKeys.every((key) => typeof key === "string")) return undefined
  const parsed = parseQuizPlan(JSON.stringify(value.plan), "server quiz plan")
  if (!parsed.ok || parsed.value.courseId !== value.courseId || parsed.value.unitId !== value.unitId) return undefined
  const correctQuestionIds = Array.isArray(value.correctQuestionIds)
    ? value.correctQuestionIds.filter((id): id is string => typeof id === "string")
    : []
  return {
    courseId: value.courseId,
    unitId: value.unitId,
    plan: parsed.value,
    answeredQuestionIds: value.answeredQuestionIds,
    answeredPlacementKeys: value.answeredPlacementKeys,
    correctQuestionIds,
    wrongQuestionIds: Array.isArray(value.wrongQuestionIds)
      ? value.wrongQuestionIds.filter((id): id is string => typeof id === "string")
      : [],
    recentGradedResults: Array.isArray(value.recentGradedResults)
      ? value.recentGradedResults.filter((result): result is GradedResult => result === "correct" || result === "wrong")
      : [],
  }
}

class Session {
  private readonly host: HTMLElement
  private readonly root: ShadowRoot
  private readonly answered: Set<string>
  private readonly answeredPlacements: Set<string>
  private readonly sessionOutcomes: PlacementOutcome[] = []
  private readonly correct: Set<string>
  private readonly missed: Set<string>
  private readonly gradedResults: GradedResult[] = []
  private previousTime: number
  private seeking = false
  private seekPassed = new Map<number, number>()
  private overlay?: HTMLElement
  private toastTimer?: ReturnType<typeof setTimeout>
  private initialPreHandled = false
  private queue: QueuedQuestion[] = []
  private queueIndex = 0
  private selectedIndex?: number
  private enterAction?: () => void
  private skipAction?: () => void

  constructor(
    readonly videoId: string,
    readonly reply: PlanReply,
    readonly video: HTMLVideoElement,
  ) {
    const surface = makeSurface()
    this.host = surface.host
    this.root = surface.root
    this.answered = new Set(reply.answeredQuestionIds)
    this.answeredPlacements = new Set(reply.answeredPlacementKeys)
    this.correct = new Set(reply.correctQuestionIds)
    this.missed = new Set(reply.wrongQuestionIds)
    this.previousTime = video.currentTime
    this.showReward()
    video.addEventListener("timeupdate", this.onTimeUpdate)
    video.addEventListener("seeking", this.onSeeking)
    video.addEventListener("seeked", this.onSeeked)
    video.addEventListener("play", this.onPlay)
    video.addEventListener("ended", this.onEnded)
    window.addEventListener("keydown", this.onKeyDown, true)
    if (!video.paused) this.onPlay()
  }

  destroy(): void {
    this.video.removeEventListener("timeupdate", this.onTimeUpdate)
    this.video.removeEventListener("seeking", this.onSeeking)
    this.video.removeEventListener("seeked", this.onSeeked)
    this.video.removeEventListener("play", this.onPlay)
    this.video.removeEventListener("ended", this.onEnded)
    window.removeEventListener("keydown", this.onKeyDown, true)
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.host.remove()
  }

  private onSeeking = (): void => {
    this.seeking = true
    this.seekPassed.clear()
  }

  private onSeeked = (): void => {
    this.checkPlayback(true)
    this.seeking = false
    this.showPassedSeek()
  }

  private onTimeUpdate = (): void => {
    this.checkPlayback(this.seeking)
  }

  private checkPlayback(seeking: boolean): void {
    const currentTime = this.video.currentTime
    const result = playbackStep({
      previousTime: this.previousTime,
      currentTime,
      playbackRate: this.video.playbackRate,
      seeking,
      placements: this.reply.plan.placements,
      answeredPlacementKeys: this.answeredPlacements,
      sessionOutcomes: this.sessionOutcomes,
    })
    this.previousTime = currentTime
    if (result.jumped) {
      for (const placement of result.passed) {
        this.seekPassed.set(placement.index, placement.seconds)
        for (const id of placement.questionIds) if (!this.answered.has(id)) this.missed.add(id)
      }
      if (!seeking) this.showPassedSeek()
      return
    }
    if (result.trigger && !this.overlay) {
      this.video.pause()
      this.openPlacement(result.trigger.index)
    }
  }

  private showPassedSeek(): void {
    if (this.seekPassed.size === 0) return
    const times = [...this.seekPassed.values()].sort((a, b) => a - b)
    this.toast(`Passed ${times.length} unanswered ${times.length === 1 ? "quiz" : "quizzes"} at ${times.map(formatTime).join(", ")}. They will appear in the Recap quiz.`)
    this.seekPassed.clear()
  }

  private onPlay = (): void => {
    if (this.initialPreHandled || this.overlay) return
    const completed = completedPlacementKeys(
      this.reply.plan.placements,
      this.answeredPlacements,
      this.sessionOutcomes,
    )
    const index = this.reply.plan.placements.findIndex((placement) =>
      placement.kind === "pre-question"
      && !placement.location
      && !completed.has(placementKey(placement)))
    this.initialPreHandled = true
    if (index >= 0) {
      this.video.pause()
      this.openPlacement(index)
    }
  }

  private onEnded = (): void => {
    if (this.overlay) return
    const recap = recapQuestionIds({
      plan: this.reply.plan,
      answeredQuestionIds: this.answered,
      answeredPlacementKeys: this.answeredPlacements,
      sessionOutcomes: this.sessionOutcomes,
      missedQuestionIds: this.missed,
    })
    const ids = [...recap.choiceQuestionIds, ...(recap.explainBackQuestionId ? [recap.explainBackQuestionId] : [])]
    const recapIndex = this.reply.plan.placements.findIndex((placement) => placement.kind === "recap")
    this.openQuestions(ids.map((id) => ({
      id,
      placementIndex: this.sourcePlacementIndex(id, recapIndex),
      placementKey: "recap",
      recap: true,
    })))
  }

  private sourcePlacementIndex(questionId: string, fallback: number): number {
    const index = this.reply.plan.placements.findIndex((placement) =>
      placement.kind === "pre-question"
        ? placement.questionId === questionId
        : placement.kind === "pause"
          ? placement.questionIds.includes(questionId)
          : false)
    return index >= 0 ? index : fallback
  }

  private openPlacement(index: number): void {
    const placement = this.reply.plan.placements[index]
    if (!placement || placement.kind === "recap") return
    const questions = selectQuestions({
      placement,
      questionPool: this.reply.plan.questionPool,
      answeredQuestionIds: this.answered,
      recentGradedResults: [...this.reply.recentGradedResults, ...this.gradedResults],
    })
    const key = placementKey(placement)
    this.openQuestions(questions
      .map((question) => ({ id: question.id, placementIndex: index, placementKey: key, recap: false })))
  }

  private openQuestions(queue: QueuedQuestion[]): void {
    if (queue.length === 0) {
      if (!this.video.ended) void this.video.play()
      return
    }
    this.queue = queue
    this.queueIndex = 0
    this.showCurrentQuestion()
  }

  private showCurrentQuestion(): void {
    const current = this.queue[this.queueIndex]
    const question = this.reply.plan.questionPool.find((candidate) => candidate.id === current?.id)
    if (!current || !question) {
      this.finishOverlay()
      return
    }
    this.selectedIndex = undefined
    this.enterAction = undefined
    this.skipAction = () => {
      this.missed.add(question.id)
      this.record(question, "skipped")
      this.finishOverlay()
    }

    this.overlay?.remove()
    const backdrop = document.createElement("div")
    backdrop.className = "backdrop"
    const dialog = document.createElement("section")
    dialog.className = "dialog"
    dialog.setAttribute("role", "dialog")
    dialog.setAttribute("aria-modal", "true")
    dialog.setAttribute("aria-labelledby", "learning-question-title")
    dialog.setAttribute("aria-describedby", "learning-question-prompt")
    const title = document.createElement("h2")
    title.id = "learning-question-title"
    title.textContent = current.recap ? "Recap quiz" : "Question"
    const prompt = document.createElement("div")
    prompt.id = "learning-question-prompt"
    prompt.className = "prompt"
    renderText(prompt, question.prompt)
    const body = document.createElement("div")
    const actions = document.createElement("div")
    actions.className = "actions"
    const flag = this.button("Flag", () => {
      this.record(question, "flagged")
      this.showFeedback(question, "Question flagged.", false, false)
    })
    const skip = this.button("Skip", () => this.skipAction?.())
    actions.append(flag, skip)
    dialog.append(title, prompt, body, actions)
    backdrop.append(dialog)
    this.root.append(backdrop)
    this.overlay = backdrop

    if (question.kind === "choice") this.showChoice(question, body, actions)
    else this.showExplainBack(question, body, actions)
    queueMicrotask(() => dialog.querySelector<HTMLElement>("button, textarea")?.focus())
  }

  private showChoice(question: ChoiceQuestion, body: HTMLElement, actions: HTMLElement): void {
    const options = document.createElement("div")
    options.className = "options"
    options.setAttribute("role", "radiogroup")
    const optionButtons = question.options.map((option, index) => {
      const button = this.button("", () => select(index))
      button.setAttribute("role", "radio")
      button.setAttribute("aria-checked", "false")
      renderText(button, `${index + 1}. ${option}`)
      options.append(button)
      return button
    })
    const confirm = this.button("Confirm", () => {
      if (this.selectedIndex === undefined) return
      const correct = this.selectedIndex === question.correctIndex
      this.record(question, correct ? "correct" : "wrong", this.selectedIndex)
      if (!correct) this.missed.add(question.id)
      this.showFeedback(question, correct ? "Right" : "Wrong", !correct, true)
    }, "primary")
    confirm.disabled = true
    const select = (index: number): void => {
      this.selectedIndex = index
      optionButtons.forEach((button, optionIndex) => {
        button.classList.toggle("selected", optionIndex === index)
        button.setAttribute("aria-checked", String(optionIndex === index))
      })
      confirm.disabled = false
      confirm.focus()
    }
    this.enterAction = () => confirm.click()
    actions.prepend(confirm)
    body.append(options)
  }

  private showExplainBack(question: Question & { kind: "explain-back" }, body: HTMLElement, actions: HTMLElement): void {
    const textarea = document.createElement("textarea")
    textarea.setAttribute("aria-label", "Explain-back answer")
    const hint = document.createElement("p")
    hint.className = "hint"
    hint.textContent = "Use system dictation if useful. Press Shift+Enter for a new line."
    const submit = this.button("Submit", () => {
      const text = textarea.value.trim()
      if (!text) return
      this.record(question, "ungraded", undefined, text)
      this.nextQuestion()
    }, "primary")
    this.enterAction = () => submit.click()
    actions.prepend(submit)
    body.append(textarea, hint)
  }

  private showFeedback(
    question: ChoiceQuestion | Question,
    label: string,
    allowRewatch: boolean,
    revealAnswer: boolean,
  ): void {
    if (!this.overlay) return
    const dialog = this.overlay.querySelector<HTMLElement>(".dialog")!
    const oldActions = dialog.querySelector<HTMLElement>(".actions")!
    dialog.querySelectorAll("button").forEach((button) => { button.disabled = true })
    const feedback = document.createElement("div")
    feedback.className = `feedback${label === "Wrong" ? " wrong" : ""}`
    feedback.setAttribute("role", "status")
    feedback.setAttribute("aria-live", "polite")
    feedback.textContent = label
    dialog.insertBefore(feedback, oldActions)
    if (question.kind === "choice" && revealAnswer) {
      const correct = document.createElement("div")
      correct.className = "correct"
      renderText(correct, `Correct answer: ${question.options[question.correctIndex]}`)
      const explanation = document.createElement("div")
      explanation.className = "explanation"
      renderText(explanation, question.explanation)
      dialog.insertBefore(correct, oldActions)
      dialog.insertBefore(explanation, oldActions)
    }
    const actions = document.createElement("div")
    actions.className = "actions"
    if (allowRewatch) actions.append(this.button("Rewatch", () => this.rewatch()))
    actions.append(this.button("Flag", () => this.record(question, "flagged")))
    const next = this.button("Continue", () => this.nextQuestion(), "primary")
    actions.append(next)
    oldActions.replaceWith(actions)
    this.enterAction = () => next.click()
    this.skipAction = undefined
    next.focus()
  }

  private nextQuestion(): void {
    this.queueIndex += 1
    if (this.queueIndex < this.queue.length) this.showCurrentQuestion()
    else this.finishOverlay()
  }

  private finishOverlay(): void {
    this.overlay?.remove()
    this.overlay = undefined
    this.enterAction = undefined
    this.skipAction = undefined
    this.video.focus()
    if (!this.video.ended) void this.video.play()
  }

  private rewatch(): void {
    const current = this.queue[this.queueIndex]
    const previous = timedPlacements(this.reply.plan.placements)
      .filter((placement) => placement.index < current.placementIndex)
      .at(-1)
    this.overlay?.remove()
    this.overlay = undefined
    this.enterAction = undefined
    this.skipAction = undefined
    this.video.currentTime = previous?.seconds ?? 0
    this.video.focus()
    void this.video.play()
  }

  private record(
    question: Question,
    status: OutcomeInput["status"],
    chosenIndex?: number,
    text?: string,
  ): void {
    const key = this.queue[this.queueIndex]?.placementKey
    if (!key) return
    this.sessionOutcomes.push({ placementKey: key, questionId: question.id, status })
    if (status !== "skipped") this.answered.add(question.id)
    if (status === "correct" || status === "wrong") this.gradedResults.push(status)
    if (status === "correct") {
      this.correct.add(question.id)
      this.missed.delete(question.id)
    }
    this.showReward()
    const outcome: OutcomeInput = {
      type: "outcome",
      courseId: this.reply.courseId,
      unitId: this.reply.unitId,
      questionId: question.id,
      nodeId: question.nodeId,
      tier: question.tier,
      placementKey: key,
      surface: "youtube",
      status,
      answeredAt: new Date().toISOString(),
      ...(chosenIndex !== undefined && { chosenIndex }),
      ...(text !== undefined && { text }),
    }
    void send<ServerReply>({ type: "outcome", videoId: this.videoId, outcome }).then((response) => {
      if (!response.ok) this.toast("Could not save your Outcome. The learning server may be unreachable.")
    }).catch((error) => {
      this.toast("Could not save your Outcome. The learning server may be unreachable.")
      log(this.videoId, {
        level: "error",
        stage: "post_outcome",
        target: "/outcomes",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  private showReward(): void {
    this.root.querySelector(".reward")?.remove()
    const landed = landedNodeIds(this.reply.plan, this.correct).size
    const total = new Set(this.reply.plan.nodeIds).size
    const reward = document.createElement("div")
    reward.className = "reward"
    reward.setAttribute("role", "status")
    const label = document.createElement("div")
    label.textContent = `${landed} of ${total} Nodes landed`
    const track = document.createElement("div")
    track.className = "track"
    const fill = document.createElement("div")
    fill.className = "fill"
    fill.style.width = `${total ? landed / total * 100 : 0}%`
    track.append(fill)
    reward.append(label, track)
    this.root.append(reward)
  }

  private toast(message: string): void {
    this.root.querySelector(".toast")?.remove()
    if (this.toastTimer) clearTimeout(this.toastTimer)
    const toast = document.createElement("div")
    toast.className = "toast"
    toast.setAttribute("role", "status")
    toast.textContent = message
    this.root.append(toast)
    this.toastTimer = setTimeout(() => toast.remove(), 7000)
  }

  private button(label: string, action: () => void, className = ""): HTMLButtonElement {
    const button = document.createElement("button")
    button.type = "button"
    button.className = className
    button.textContent = label
    button.addEventListener("click", action)
    return button
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.overlay) return
    const dialog = this.overlay.querySelector<HTMLElement>(".dialog")
    if (!dialog) return
    const target = event.composedPath()[0]
    const typing = target instanceof HTMLTextAreaElement
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.skipAction?.()
      return
    }
    if (/^[1-9]$/.test(event.key) && !typing) {
      event.preventDefault()
      event.stopImmediatePropagation()
      const options = [...dialog.querySelectorAll<HTMLButtonElement>(".options button")]
      options[Number(event.key) - 1]?.click()
      return
    }
    if (event.key === "Enter" && (!typing || !event.shiftKey)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.enterAction?.()
      return
    }
    if (event.key !== "Tab") return
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled])")]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && this.root.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && this.root.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

let active: Session | undefined
let navigation = 0
let lastUrl = ""

function videoId(): string | undefined {
  const url = new URL(location.href)
  return url.pathname === "/watch" ? url.searchParams.get("v") || undefined : undefined
}

async function waitForVideo(token: number): Promise<HTMLVideoElement | undefined> {
  for (let attempt = 0; attempt < 40 && token === navigation; attempt += 1) {
    const video = document.querySelector<HTMLVideoElement>("video.html5-main-video")
      ?? document.querySelector<HTMLVideoElement>("video")
    if (video) return video
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return undefined
}

async function navigate(): Promise<void> {
  const url = location.href
  if (url === lastUrl) return
  lastUrl = url
  navigation += 1
  const token = navigation
  active?.destroy()
  active = undefined
  document.getElementById(HOST_ID)?.remove()
  const id = videoId()
  if (!id) return

  const response: ServerReply = await send<ServerReply>({ type: "plan", videoId: id }).catch((error): ServerReply => ({
    ok: false,
    status: 0,
    error: error instanceof Error ? error.message : String(error),
  }))
  if (token !== navigation) return
  if (!response.ok) {
    if (response.status === 404) {
      log(id, { level: "info", stage: "load_quiz_plan", target: id, status: "not_course_unit" })
      return
    }
    const surface = makeSurface()
    const toast = document.createElement("div")
    toast.className = "toast"
    toast.setAttribute("role", "alert")
    toast.textContent = "Learning server unreachable, is your Mac on?"
    surface.root.append(toast)
    setTimeout(() => surface.host.remove(), 7000)
    return
  }
  const reply = decodePlan(response.data)
  if (!reply) {
    log(id, { level: "error", stage: "decode_quiz_plan", target: id, status: "failed", error: "invalid server response" })
    const surface = makeSurface()
    const toast = document.createElement("div")
    toast.className = "toast"
    toast.setAttribute("role", "alert")
    toast.textContent = "The learning server returned an invalid Quiz plan."
    surface.root.append(toast)
    setTimeout(() => surface.host.remove(), 7000)
    return
  }
  const video = await waitForVideo(token)
  if (!video || token !== navigation) return
  active = new Session(id, reply, video)
}

document.addEventListener("yt-navigate-finish", () => void navigate())
setInterval(() => {
  if (location.href !== lastUrl) void navigate()
}, 500)
void navigate()
