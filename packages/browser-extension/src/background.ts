import type { ClientLogLine, OutcomeInput } from "@learn/core"

const SERVER = "http://127.0.0.1:4517"
const LOG_KEY = "learningLogs"
const MAX_LOGS = 400

type StoredLog = ClientLogLine & { ts: string }
type Message =
  | { type: "plan"; videoId: string }
  | { type: "outcome"; videoId: string; outcome: OutcomeInput }
  | { type: "log"; videoId?: string; line: ClientLogLine }
  | { type: "health" }
  | { type: "logs" }

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
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  await log({ level: "info", stage, target, status: "start" }, videoId)
  try {
    const response = await fetch(`${SERVER}${target}`, init)
    const data = await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = typeof data === "object" && data && "error" in data
        ? String(data.error)
        : `HTTP ${response.status}`
      await log({ level: response.status === 404 ? "info" : "error", stage, target, status: String(response.status), error }, videoId)
      return { ok: false, status: response.status, error }
    }
    await log({ level: "info", stage, target, status: "ok" }, videoId)
    return { ok: true, status: response.status, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log({ level: "error", stage, target, status: "failed", error: message }, videoId)
    return { ok: false, status: 0, error: message }
  }
}

async function handle(message: Message): Promise<unknown> {
  if (message.type === "plan") {
    const target = `/quiz-plans/by-video/${encodeURIComponent(message.videoId)}`
    return request("fetch_quiz_plan", target, message.videoId)
  }
  if (message.type === "outcome") {
    return request("post_outcome", "/outcomes", message.videoId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message.outcome),
    })
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
