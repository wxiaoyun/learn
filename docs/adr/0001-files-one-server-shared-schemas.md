---
status: accepted
---

# State in files, one local server, schemas defined once

The learner's state must be shared by surfaces that cannot share code paths: coding agents that read files, a browser extension that cannot touch disk, and later a phone. We keep all state as files under one courses root (`nodes.json`, `quiz-plans/<unitId>.json`, `outcomes.jsonl`, `LEARNING.md` as the human dashboard). One local server owns every write. Every schema is defined once in `packages/core`, and each surface reaches the server through the transport that suits it: HTTP for the browser extension and the mobile surface, MCP for Claude Code, and registered tools from a pi extension for pi, because pi has no MCP client by design.

The server binds `127.0.0.1` and rejects requests whose `Origin` is not the browser extension, because any web page can reach localhost. It runs as a launchd agent with `RunAtLoad` and `KeepAlive`. A Chrome extension cannot spawn processes, and Claude Code and the phone need the server when Chrome is not involved, so no client is responsible for starting it.

## Considered Options

- **Chrome native messaging host.** No daemon and no port, but it serves only the browser. MCP and the phone would still need a server.
- **Cloud sync.** Reachable from anywhere, but needs hosting, auth, and conflict handling for a single-user system.
- **Files only, with a `validate` CLI.** Agents hand-write JSON and validate afterwards. Rejected because typed tool schemas reject a malformed quiz plan at write time, and the server exists anyway for the browser.

## Consequences

- Agents may still `Read` state files directly. Only writes must go through the typed tools.
- Outcomes are append-only with deterministic IDs, so a retried write is harmless and no surface needs conflict resolution.
- The repo holds no personal data. Courses live outside it, under the configured courses root.
