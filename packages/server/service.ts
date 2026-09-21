import { getLearningRoot } from "@learn/core/node"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const label = "com.local.learning-server"
const action = process.argv[2]
const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`)
const root = getLearningRoot()
const logs = join(root, ".logs")
// launchd runs the compiled binary directly, so the agent does not depend on
// where bun is installed. `mise run service:install` builds it first.
const binary = resolve(import.meta.dir, "dist/learning-server")
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

// Unloading a service that is not loaded fails with "Boot-out failed: 5". That
// is the normal case on a first install, so keep it off the terminal.
async function bootoutQuietly(): Promise<void> {
  await Bun.spawn(["launchctl", "bootout", `gui/${uid}`, plist], { stdout: "ignore", stderr: "ignore" }).exited
}

// launchd reads no shell profile, so the plist carries PATH itself. Take it
// from a clean login shell (.zprofile) instead of the shell running the
// install, which drags in session-only entries like virtualenvs.
async function loginShellPath(): Promise<string> {
  const shell = process.env.SHELL?.trim() || "/bin/zsh"
  const child = Bun.spawn([shell, "-lc", 'printf %s "$PATH"'], {
    env: { HOME: homedir(), USER: process.env.USER ?? "" },
    stdout: "pipe",
    stderr: "ignore",
  })
  const path = (await new Response(child.stdout).text()).trim()
  const code = await child.exited
  if (code !== 0 || !path) {
    console.warn(JSON.stringify({ stage: "login_shell_path", target: shell, status: "fallback", error: `exit code ${code}` }))
    return process.env.PATH?.trim() || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  }
  return path
}

if (action === "install") {
  if (!(await Bun.file(binary).exists())) throw new Error(`${binary} is missing, run: bun run --cwd packages/server build`)
  await mkdir(dirname(plist), { recursive: true })
  await mkdir(logs, { recursive: true })
  const environment = {
    LEARNING_ROOT: root,
    LEARNING_PORT: process.env.LEARNING_PORT?.trim() || "4517",
    LEARNING_ALLOWED_ORIGINS: process.env.LEARNING_ALLOWED_ORIGINS ?? "",
    LEARNING_AGENT: process.env.LEARNING_AGENT?.trim() || "claude",
    LEARNING_AGENT_TIMEOUT_MS: process.env.LEARNING_AGENT_TIMEOUT_MS?.trim() || "300000",
    PATH: await loginShellPath(),
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
      <string>${xml(binary)}</string>
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
  await bootoutQuietly()
  const code = await launchctl("bootstrap", `gui/${uid}`, plist)
  if (code !== 0) throw new Error(`launchctl bootstrap failed with exit code ${code}`)
  console.log(`Installed ${plist}`)
} else if (action === "uninstall") {
  await bootoutQuietly()
  await rm(plist, { force: true })
  console.log(`Removed ${plist}`)
} else {
  throw new Error("usage: mise run service:install or mise run service:uninstall")
}
