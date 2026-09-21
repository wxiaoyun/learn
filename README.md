# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

A personal learning system. It teaches in small, quiz-checked steps and keeps one model of what you know across every place you study: a coding agent, YouTube, and a review page in the browser.

This is a fork of [amosblomqvist/learn](https://github.com/amosblomqvist/learn), the system from Amos Blomqvist's video [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU). The teaching philosophy in the `teach` skill is his. The fork turns the original pi configuration into a monorepo with a local server, a browser extension, and support for Claude Code next to pi. It is built for one learner and shared as is.

## How it works

1. **Preparation**, once per course. Hand the agent a playlist, slides, or a course website. It collects the material, builds a roadmap, and waits for your approval.
2. **Primer**, before each unit. The agent probes what the unit assumes, teaches any gaps, and writes that unit's quiz plan.
3. **Learn.** Watch the video. The browser extension pauses at the right moments for pre-questions and pause quizzes, runs a recap quiz at the end, and lets you ask the agent something mid-video with `A`. The agent knows where in the video you are.
4. **Return.** Back in the agent, your outcomes are already there. It judges what is solid, grades your explain-backs, repairs flagged questions, offers due reviews, and runs the next primer.

Nothing waits on a model while you watch. Quiz plans are written ahead of time, each node's questions climb from recall to application, and spaced review follows Leitner intervals of 1, 3, 7, and 21 days. The vocabulary is in [CONTEXT.md](CONTEXT.md), the rules and contracts are in [docs/plan.md](docs/plan.md), and the two architecture decisions are in [docs/adr](docs/adr).

## Layout

- `packages/core/` holds the shared schemas (Effect Schema), file helpers, and the skills: `teach`, `prepare-course`, `primer`, `learning-progress`, `visualize`. It is also the Claude Code plugin root.
- `packages/server/` is the local server (Effect, bun). It owns every write to course state and serves HTTP for the browser, MCP for Claude Code, and the same tools for pi.
- `packages/pi/` holds the pi extensions, agents, and settings.
- `packages/browser-extension/` is the Chrome extension: quizzes over YouTube, asks, the review page, and a due count badge.

Course data lives outside the repo, under `~/learning` by default.

## Requirements

- [mise](https://mise.jdx.dev), which pins [bun](https://bun.sh) for this repo
- [pi](https://github.com/earendil-works/pi) or [Claude Code](https://claude.com/claude-code), or both
- `yt-dlp` and `jq` for preparing YouTube courses
- Chrome for the browser extension

## Setup

```bash
git clone git@github.com:wxiaoyun/learn.git
cd learn
mise trust && mise install
mise run setup
```

`setup` installs dependencies, then prepares the learning directory (`LEARNING_ROOT`, default `~/learning`), which is where you study and where courses are stored: it links `packages/pi` there as `.pi`, and installs the Claude Code plugin for that directory only (local scope). It is safe to run again. `mise run setup:undo` removes the link and the plugin.

### Server

```bash
bun run server
```

To keep it running across logins on macOS, `mise run service:install` writes and loads a LaunchAgent, and `mise run service:uninstall` removes it. The environment variables below are read at install time and written into the LaunchAgent.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LEARNING_ROOT` | `~/learning` | Where courses are stored |
| `LEARNING_PORT` | `4517` | Port on `127.0.0.1` |
| `LEARNING_ALLOWED_ORIGINS` | the browser extension | Comma separated origins allowed to call the server. The extension's ID is fixed by the key in its manifest, so the default already allows it |
| `LEARNING_AGENT` | `claude` | Driver for agent turns the server starts: `claude`, `pi`, or `off` |

The server starts a headless agent turn for three things: grading an explain-back, answering an ask, and writing the next unit's quiz plan after a recap quiz. Each has a fallback, so `off` loses speed and nothing else. With `claude`, these turns run `claude -p` on your Claude subscription.

### pi

`setup` already linked `.pi` into the learning directory, so start pi there. To use it in another project, link the pi config there:

```bash
cd /path/to/your-learning-project
ln -s /path/to/learn/packages/pi .pi
```

The visual makers need a subagent implementation such as [pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents), and their system rendering tools.

### Claude Code

`setup` already installed the plugin for Claude Code sessions started in the learning directory: the five skills and the `learning` MCP server, which needs the server running. To have it in every project, install it at user scope:

```bash
claude plugin marketplace add /path/to/learn
claude plugin install learning@learning
```

### Browser extension

```bash
bun run --cwd packages/browser-extension build
```

Open `chrome://extensions`, turn on Developer mode, choose Load unpacked, and pick `packages/browser-extension/dist`. To see it work without a real course, run `bun run --cwd packages/browser-extension seed-demo` and open the video named in [its README](packages/browser-extension/README.md).

Keys in a quiz: number keys pick an option, Enter confirms, Escape skips. `A` opens the ask panel. "Copy logs" on the nodes bar or in the toolbar popup copies a log bundle you can hand to a coding agent.

## Development

```bash
bun test
bun run typecheck
```

Tests never start a real agent. They use a stub driver.
