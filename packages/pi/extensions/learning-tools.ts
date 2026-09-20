import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { TSchema } from "@sinclair/typebox"
import { agentTools } from "../../server/tools"

const port = process.env.LEARNING_PORT?.trim() || "4517"
const server = `http://127.0.0.1:${port}`

function log(stage: string, target: string, status: string, error?: string): void {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: error ? "error" : "info",
    stage,
    target,
    status,
    surface: "agent",
    ...(error && { error }),
  }))
}

export default function learningTools(pi: ExtensionAPI) {
  for (const tool of agentTools) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema as unknown as TSchema,
      async execute(_toolCallId, params, signal) {
        const target = `${server}/tools/${encodeURIComponent(tool.name)}`
        let response: Response
        log("tool_http", target, "start")
        try {
          response = await fetch(target, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(params),
            signal,
          })
        } catch (error) {
          const message = `learning server unreachable at ${server}, is it running?`
          log("tool_http", target, "failed", error instanceof Error ? error.message : String(error))
          throw new Error(message)
        }
        const text = await response.text()
        if (!response.ok) {
          let message = text
          try {
            message = (JSON.parse(text) as { error?: string }).error ?? text
          } catch {}
          const error = message || `learning server returned HTTP ${response.status}`
          log("tool_http", target, `http_${response.status}`, error)
          throw new Error(error)
        }
        let result: unknown
        try {
          result = JSON.parse(text)
        } catch (error) {
          log("tool_http_decode", target, "failed", error instanceof Error ? error.message : String(error))
          throw new Error(`learning server returned invalid JSON for ${tool.name}`)
        }
        log("tool_http", target, "ok")
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        }
      },
    })
  }
}
