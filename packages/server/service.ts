import { getLearningRoot } from "@learn/core/node"
import { mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const label = "com.local.learning-server"
const action = process.argv[2]
const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`)
const root = getLearningRoot()
const logs = join(root, ".logs")
const entry = resolve(import.meta.dir, "index.ts")
const bunPath = await realpath(process.execPath)
const uid = process.getuid?.()
if (uid === undefined) throw new Error("launchd service installation requires macOS")

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

async function launchctl(...args: string[]): Promise<number> {
  return Bun.spawn(["launchctl", ...args], { stdout: "inherit", stderr: "inherit" }).exited
}

if (action === "install") {
  await mkdir(dirname(plist), { recursive: true })
  await mkdir(logs, { recursive: true })
  const environment = {
    LEARNING_ROOT: root,
    LEARNING_PORT: process.env.LEARNING_PORT?.trim() || "4517",
    LEARNING_ALLOWED_ORIGINS: process.env.LEARNING_ALLOWED_ORIGINS ?? "",
    LEARNING_AGENT: process.env.LEARNING_AGENT?.trim() || "claude",
    LEARNING_AGENT_TIMEOUT_MS: process.env.LEARNING_AGENT_TIMEOUT_MS?.trim() || "300000",
    PATH: process.env.PATH?.trim() || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  }
  const variables = Object.entries(environment)
    .map(([key, value]) => `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`)
    .join("\n")
  const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(bunPath)}</string>
      <string>run</string>
      <string>${xml(entry)}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${variables}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xml(join(logs, "launchd-stdout.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(logs, "launchd-stderr.log"))}</string>
  </dict>
</plist>
`
  await writeFile(plist, contents, "utf8")
  await launchctl("bootout", `gui/${uid}`, plist)
  const code = await launchctl("bootstrap", `gui/${uid}`, plist)
  if (code !== 0) throw new Error(`launchctl bootstrap failed with exit code ${code}`)
  console.log(`Installed ${plist}`)
} else if (action === "uninstall") {
  await launchctl("bootout", `gui/${uid}`, plist)
  await rm(plist, { force: true })
  console.log(`Removed ${plist}`)
} else {
  throw new Error("usage: bun run service.ts install|uninstall")
}
