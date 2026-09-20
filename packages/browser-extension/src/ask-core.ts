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
