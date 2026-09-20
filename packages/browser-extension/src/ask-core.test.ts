import { describe, expect, test } from "bun:test"
import { askPollDecision, formatVideoTime, opensAskPanel } from "./ask-core"

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
