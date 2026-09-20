import type { AskInput, ClientLogLine, OutcomeInput } from "@learn/core"

const SERVER = "http://127.0.0.1:4517"
const LOG_KEY = "learningLogs"
const MAX_LOGS = 400

type StoredLog = ClientLogLine & { ts: string }
type ServerReply = { ok: boolean; status: number; data?: unknown; error?: string }
type Message =
  | { type: "plan"; videoId: string }
  | { type: "outcome"; videoId: string; outcome: OutcomeInput }
  | { type: "askHistory"; videoId: string }
  | { type: "askPost"; videoId: string; ask: AskInput }
  | { type: "askGet"; videoId: string; askId: string }
  | { type: "reviewOutcome"; outcome: OutcomeInput }
  | { type: "reviewDue" }
  | { type: "reviewStreak" }
  | { type: "grade"; videoId: string; outcomeId: string }
  | { type: "log"; videoId?: string; line: ClientLogLine }
  | { type: "health" }
  | { type: "logs" }

const BADGE_ALARM = "refresh-due-reviews"

let storageQueue = Promise.resolve()

function store(line: ClientLogLine): Promise<void> {
  const record: StoredLog = { ts: new Date().toISOString(), ...line }
  const write = storageQueue.then(async () => {
    const current = await chrome.storage.local.get(LOG_KEY)
    const logs = Array.isArray(current[LOG_KEY]) ? current[LOG_KEY] as StoredLog[] : []
    await chrome.storage.local.set({ [LOG_KEY]: [...logs, record].slice(-MAX_LOGS) })
  })
  storageQueue = write.catch(() => undefined)
  return write
}

async function forward(line: ClientLogLine): Promise<void> {
  try {
    await fetch(`${SERVER}/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surface: "youtube", lines: [line] }),
    })
  } catch {
    // Local copy remains available when server is down.
  }
}

async function log(line: ClientLogLine, videoId?: string): Promise<void> {
  const withJob = videoId
    ? { ...line, fields: { ...line.fields, job_id: videoId } }
    : line
  try {
    await store(withJob)
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      stage: "store_client_log",
      target: LOG_KEY,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }))
  }
  await forward(withJob)
}

async function request(
  stage: string,
  target: string,
  videoId?: string,
  init?: RequestInit,
): Promise<ServerReply> {
  await log({ level: "info", stage, target, status: "start" }, videoId)
  try {
    const response = await fetch(`${SERVER}${target}`, init)
    const data = await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = typeof data === "object" && data && "error" in data
        ? String(data.error)
        : `HTTP ${response.status}`
      await log({ level: response.status === 404 ? "info" : "error", stage, target, status: String(response.status), error }, videoId)
      return { ok: false, status: response.status, data, error }
    }
    await log({ level: "info", stage, target, status: "ok" }, videoId)
    return { ok: true, status: response.status, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log({ level: "error", stage, target, status: "failed", error: message }, videoId)
    return { ok: false, status: 0, error: message }
  }
}

async function setBadge(text: string): Promise<void> {
  await log({ level: "info", stage: "set_due_badge", target: "toolbar", status: "start" })
  try {
    await chrome.action.setBadgeText({ text })
    await log({ level: "info", stage: "set_due_badge", target: "toolbar", status: "ok" })
  } catch (error) {
    await log({
      level: "error",
      stage: "set_due_badge",
      target: "toolbar",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function refreshBadge(): Promise<void> {
  const response = await request("refresh_due_badge", "/reviews/due")
  if (!response.ok) {
    await setBadge("")
    return
  }
  const reviews = response.data && typeof response.data === "object"
    ? (response.data as Record<string, unknown>).reviews
    : undefined
  if (!Array.isArray(reviews)) {
    await log({
      level: "error",
      stage: "refresh_due_badge",
      target: "/reviews/due",
      status: "failed",
      error: "invalid server response",
    })
    await setBadge("")
    return
  }
  await setBadge(reviews.length === 0 ? "" : String(reviews.length))
}

async function scheduleBadgeRefresh(): Promise<void> {
  await log({ level: "info", stage: "schedule_due_badge", target: BADGE_ALARM, status: "start" })
  try {
    await chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 })
    await log({ level: "info", stage: "schedule_due_badge", target: BADGE_ALARM, status: "ok" })
  } catch (error) {
    await log({
      level: "error",
      stage: "schedule_due_badge",
      target: BADGE_ALARM,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handle(message: Message): Promise<unknown> {
  if (message.type === "plan") {
    const target = `/quiz-plans/by-video/${encodeURIComponent(message.videoId)}`
    return request("fetch_quiz_plan", target, message.videoId)
  }
  if (message.type === "askHistory") {
    return request("fetch_ask_history", `/asks/by-video/${encodeURIComponent(message.videoId)}`, message.videoId)
  }
  if (message.type === "askPost") {
    return request("post_ask", "/asks", message.videoId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message.ask),
    })
  }
  if (message.type === "askGet") {
    return request("fetch_ask", `/asks/${encodeURIComponent(message.askId)}`, message.videoId)
  }
  if (message.type === "outcome") {
    return request("post_outcome", "/outcomes", message.videoId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message.outcome),
    })
  }
  if (message.type === "reviewOutcome") {
    const response = await request("post_review_outcome", "/outcomes", undefined, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message.outcome),
    })
    await refreshBadge()
    return response
  }
  if (message.type === "reviewDue") return request("fetch_due_reviews", "/reviews/due")
  if (message.type === "reviewStreak") return request("refresh_review_streak", "/reviews/due")
  if (message.type === "grade") {
    return request("fetch_grade", `/grades/${encodeURIComponent(message.outcomeId)}`, message.videoId)
  }
  if (message.type === "log") {
    await log(message.line, message.videoId)
    return { ok: true }
  }
  if (message.type === "health") return request("health_check", "/health")
  await storageQueue
  const current = await chrome.storage.local.get(LOG_KEY)
  return Array.isArray(current[LOG_KEY]) ? current[LOG_KEY] : []
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    status: 0,
    error: error instanceof Error ? error.message : String(error),
  }))
  return true
})

chrome.runtime.onInstalled.addListener(() => {
  void scheduleBadgeRefresh()
  void refreshBadge()
})
chrome.runtime.onStartup.addListener(() => {
  void scheduleBadgeRefresh()
  void refreshBadge()
})
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) void refreshBadge()
})
