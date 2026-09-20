import { describe, expect, test } from "bun:test"
import { askPollDecision, formatVideoTime, learningKeyDecision, opensAskPanel } from "./ask-core"

const shortcut = (values: Partial<Parameters<typeof opensAskPanel>[0]> = {}) => opensAskPanel({
  key: "a",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  typing: false,
  quizOpen: false,
  ...values,
})

const key = (values: Partial<Parameters<typeof learningKeyDecision>[0]> = {}) => learningKeyDecision({
  eventType: "keydown",
  key: "x",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  typing: false,
  quizOpen: false,
  pathContainsHost: true,
  textFieldFocused: false,
  ui: "quiz",
  askAvailable: true,
  ...values,
})

describe("keyboard containment", () => {
  test("contains text entry without turning it into an action", () => {
    expect(key({ key: " ", textFieldFocused: true })).toEqual({ contain: true, action: "none" })
    expect(key({ key: "k", textFieldFocused: true, ui: "ask" })).toEqual({ contain: true, action: "none" })
    expect(key({ key: "4", textFieldFocused: true })).toEqual({ contain: true, action: "none" })
  })

  test("keeps quiz and Ask controls", () => {
    expect(key({ key: "4" })).toEqual({ contain: true, action: "quiz-option" })
    expect(key({ key: "Enter", textFieldFocused: true, ui: "ask" })).toEqual({ contain: true, action: "ask-submit" })
    expect(key({ key: "Enter", shiftKey: true, textFieldFocused: true, ui: "ask" })).toEqual({ contain: true, action: "none" })
    expect(key({ key: "Escape", ui: "ask" })).toEqual({ contain: true, action: "ask-close" })
    expect(key({ key: "Escape" })).toEqual({ contain: true, action: "quiz-skip" })
  })

  test("contains every keyboard event from a host and passes outside keys", () => {
    expect(key({ eventType: "keypress", key: "k", ui: "ask" })).toEqual({ contain: true, action: "none" })
    expect(key({ eventType: "keyup", key: "k", ui: "ask" })).toEqual({ contain: true, action: "none" })
    expect(key({ pathContainsHost: false, key: "k", ui: "none" })).toEqual({ contain: false, action: "none" })
    expect(key({ pathContainsHost: false, key: "a", ui: "none" })).toEqual({ contain: true, action: "open-ask" })
    expect(key({ pathContainsHost: false, key: "a", typing: true, ui: "none" })).toEqual({ contain: false, action: "none" })
    expect(key({ pathContainsHost: false, key: "a", quizOpen: true })).toEqual({ contain: false, action: "none" })
  })
})

describe("Ask panel logic", () => {
  test("opens only for an unmodified A outside editing and quizzes", () => {
    expect(shortcut()).toBe(true)
    expect(shortcut({ key: "b" })).toBe(false)
    expect(shortcut({ ctrlKey: true })).toBe(false)
    expect(shortcut({ typing: true })).toBe(false)
    expect(shortcut({ quizOpen: true })).toBe(false)
  })

  test("formats video positions", () => {
    expect(formatVideoTime(0)).toBe("0:00")
    expect(formatVideoTime(125.9)).toBe("2:05")
    expect(formatVideoTime(-1)).toBe("0:00")
  })

  test("stops polling for an Answer, failure, or timeout", () => {
    expect(askPollDecision({ attempt: 1, maxAttempts: 40, hasAnswer: false, failed: false })).toBe("wait")
    expect(askPollDecision({ attempt: 1, maxAttempts: 40, hasAnswer: true, failed: false })).toBe("answered")
    expect(askPollDecision({ attempt: 1, maxAttempts: 40, hasAnswer: false, failed: true })).toBe("failed")
    expect(askPollDecision({ attempt: 40, maxAttempts: 40, hasAnswer: false, failed: false })).toBe("timeout")
  })
})
