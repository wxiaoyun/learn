export type AskShortcutInput = {
  readonly key: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly typing: boolean
  readonly quizOpen: boolean
}

export function opensAskPanel(input: AskShortcutInput): boolean {
  return input.key.toLowerCase() === "a"
    && !input.altKey
    && !input.ctrlKey
    && !input.metaKey
    && !input.shiftKey
    && !input.typing
    && !input.quizOpen
}

export type LearningUi = "none" | "ask" | "quiz"
export type LearningKeyAction =
  | "none"
  | "open-ask"
  | "ask-submit"
  | "ask-close"
  | "quiz-option"
  | "quiz-enter"
  | "quiz-skip"
  | "quiz-tab"

export function learningKeyDecision(input: AskShortcutInput & {
  readonly eventType: "keydown" | "keypress" | "keyup"
  readonly pathContainsHost: boolean
  readonly textFieldFocused: boolean
  readonly ui: LearningUi
  readonly askAvailable: boolean
}): { readonly contain: boolean; readonly action: LearningKeyAction } {
  if (input.pathContainsHost) {
    if (input.eventType !== "keydown") return { contain: true, action: "none" }
    if (input.key === "Escape") {
      return { contain: true, action: input.ui === "ask" ? "ask-close" : input.ui === "quiz" ? "quiz-skip" : "none" }
    }
    if (input.ui === "ask") {
      return {
        contain: true,
        action: input.key === "Enter" && !input.shiftKey && input.textFieldFocused ? "ask-submit" : "none",
      }
    }
    if (input.ui === "quiz") {
      if (/^[1-9]$/.test(input.key) && !input.textFieldFocused) return { contain: true, action: "quiz-option" }
      if (input.key === "Enter" && (!input.textFieldFocused || !input.shiftKey)) {
        return { contain: true, action: "quiz-enter" }
      }
      if (input.key === "Tab") return { contain: true, action: "quiz-tab" }
    }
    return { contain: true, action: "none" }
  }
  const open = input.eventType === "keydown"
    && input.askAvailable
    && opensAskPanel(input)
  return { contain: open, action: open ? "open-ask" : "none" }
}

export function formatVideoTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

export type AskPollDecision = "wait" | "answered" | "failed" | "timeout"

export function askPollDecision(input: {
  readonly attempt: number
  readonly maxAttempts: number
  readonly hasAnswer: boolean
  readonly failed: boolean
}): AskPollDecision {
  if (input.hasAnswer) return "answered"
  if (input.failed) return "failed"
  return input.attempt >= input.maxAttempts ? "timeout" : "wait"
}
