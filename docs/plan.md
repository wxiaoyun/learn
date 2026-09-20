# Plan

Vocabulary is defined in [CONTEXT.md](../CONTEXT.md). Architecture decisions are in [docs/adr](./adr/).

## Purpose

One learning system with one model of what the learner knows, across every surface. Steps are small, each a manageable stretch from the last. Quizzing is constant. The system must be enjoyable enough to sustain, which counts as much as the learning outcome. Every surface is judged on whether it feels good to use.

## Study loop

1. **Preparation**, once per course. The learner hands over source material. The agent collects it (for YouTube, transcripts through `yt-dlp`), builds the roadmap with one entry per unit, and waits for the learner to approve it.
2. **Primer**, before each unit. The agent probes the nodes the unit assumes, teaches any gaps with the `teach` loop, creates the unit's nodes, and generates the unit's quiz plan with a tier pool per node. A `researcher` pass verifies every question against the source material. Slides and written material are ground truth over auto captions.
3. **Learn.** The learner works through the unit on whichever surface fits it. For a YouTube video, the browser extension finds the quiz plan by video ID and plays it. A unit with no playing surface, such as a textbook chapter, gets its pre-questions at the end of the primer and its recap quiz on the agent surface at return.
4. **Return.** The agent ingests new outcomes, judges Knowledge State per node, grades explain-backs, and runs the next primer. Outcomes are the prior: the agent probes only nodes with no evidence or conflicting evidence, and missed nodes go straight to the teach loop.

## Rules

### Quiz plan

- A pause quiz sits at a node boundary, not on a timer. Roughly one per 5 to 8 minutes of video, at most 2 questions each.
- About 60 percent recall tier and 40 percent application tier. Easy recall questions are wanted: they are a quick win when known and a good catch when not.
- One pre-question per major segment.
- A recap quiz has 5 to 8 questions, application heavy, unanswered and missed items first, plus one explain-back.
- Question options follow the construction procedure in the `teach` skill.
- Every question names exactly one node.

### Playing a quiz plan on YouTube

- Everything is skippable. A skipped quiz stays unanswered.
- An unanswered pause quiz triggers when normal playback crosses its location, on first watch or rewatch. An answered one never triggers again.
- Seeking past pause quizzes opens nothing. One toast lists what was passed, and those quizzes appear in the recap quiz.
- A wrong answer shows the explanation and a button to rewatch from the node's timestamp.
- A flag action marks a bad question. Flagged outcomes never count toward Knowledge State and are queued for the agent to fix.
- Playback speed gets no special handling.
- A video belongs to exactly one course. The server rejects a duplicate video ID.

### Evidence and review

- Tier selection steers the rolling success rate toward about 85 percent. When a pre-question or pause quiz triggers, a pure core function re-picks its questions from the pool for the same nodes, using the last 10 graded choice outcomes: below 0.75 it prefers recall tier, above 0.9 application tier, otherwise the authored questions stand. With fewer than 5 graded outcomes the authored questions stand. No randomness.
- Only application tier outcomes promote a node. Recall outcomes are warm-up.
- Spaced review uses Leitner intervals of 1, 3, 7, and 21 days, reset on a miss. Move to FSRS only if the intervals feel wrong after a month of real use. A node enters review at its first correct application tier outcome. A correct review on or after the due time advances one box, an early one changes nothing, a wrong one resets. An explain-back graded `partial` or `not-understood` counts as wrong. Boxes, due times, and the streak are derived from `outcomes.jsonl` on every call. Nothing is stored and no scheduler runs.
- Question ids are unique across a whole course, because a review outcome carries no unit id.
- A review draws an unseen question from the node's pool. When the pool runs out, the agent refills it.
- An explain-back is a plain text field on every surface. System dictation covers voice. It is stored ungraded, then graded by a headless agent turn when possible, else at the next session. A grade is a judgment on the node plus one sentence on what was missing, never a bare score.

### Rewards

Three signals only: instant right or wrong with the explanation, a per-unit bar of nodes landed, and a daily streak that counts only real evidence (one due review done, or one new node passed at application tier). No XP, levels, or badges.

### Failure and logging

- No offline handling in the browser extension. It assumes the server is running.
- Any failure shows a toast that says what happened in plain words, for example "learning server unreachable, is your Mac on?". It never blocks the video.
- Every package writes structured logs with `stage`, `target`, `status`, and `error` fields. The server writes one JSONL log file. The browser extension and the app forward their logs to the server and keep a "copy logs" button, so one bundle can be handed to a coding agent.
- The mobile surface is the one exception to the no offline rule. It caches a batch of due questions and queues outcomes until the next sync.

## Repo layout

bun is the runtime wherever supported and the package manager everywhere. The server is written with Effect. Core schemas use `effect/Schema` as the single schema source, and emit JSON Schema for pi tool registration and MCP. Core keeps pure schemas and Node-only file helpers in separate entry points, so the browser extension never bundles `fs`.

```
packages/
  core/                 schemas, parse and serialize, skills/
  server/               HTTP, MCP, logging, launchd install script
  pi/                   pi extensions, agents, settings
  browser-extension/    YouTube surface
  mobile/               Expo app (last milestone)
docs/
CONTEXT.md
```

## Server contract

The server listens on `127.0.0.1`, port from `LEARNING_PORT`, default `4517`. Courses root from `LEARNING_ROOT`, default `~/learning`. All payloads are the core schemas. A request that carries an `Origin` header is rejected unless the origin is listed in `LEARNING_ALLOWED_ORIGINS` (comma separated). The browser extension has a fixed ID, so the value is `chrome-extension://ikiokbkockjjgcogfnggafjclojofmbj`. Requests with no `Origin` header (curl, MCP clients, pi) are allowed.

Clients never supply record ids. The server computes every Outcome id from the Question id, the surface, and `answeredAt`, so a retried write is reported as a duplicate and changes nothing.

Agent tools are defined once in `packages/server/tools.ts`. Claude Code reaches them over MCP at `/mcp`. pi reaches the same handlers through `POST /tools/:name`, called by the pi extension `learning-tools.ts`.

- `list_courses {}`: course ids and titles.
- `get_course_state { courseId }`: roadmap, nodes, a per-node summary of outcomes (counts by tier, latest outcome time, latest correct application tier time, latest wrong time, Leitner box, and due time), ungraded explain-backs, and flagged questions.
- `put_roadmap { roadmap }`, `put_nodes { courseId, nodes }`, `put_quiz_plan { courseId, unitId, plan }`: validated full replace of one file.
- `get_outcomes { courseId, since? }`: outcome records for one course.
- `append_outcome { outcome, answeredAt? }`, `append_grade { courseId, grade }`: append one record. `answeredAt` defaults to now on the agent tool. The server stamps each grade with `gradedAt`, which is what incremental ingest filters on. An outcome may carry its `tier`, which is how an ad hoc question asked on the agent surface counts as evidence.
- `get_due_reviews { courseId? }`: nodes due for spaced review across courses, each with a picked question and a `poolExhausted` flag, plus the daily streak.

HTTP for the browser extension and the mobile surface:

- `GET /health`
- `GET /quiz-plans/by-video/:videoId`: the course id, unit id, quiz plan, three lists of question ids (answered, meaning any outcome other than skipped, then correct, then wrong by the latest outcome per question), and the last 10 graded results for the course, which seed tier selection. 404 when no plan exists. When the video belongs to a roadmap unit that has no quiz plan yet, the 404 body says so and carries a hint derived on each request: "visit the agent first" with up to three node titles when a prerequisite node was last answered wrong, "a quiz plan is being generated, reload in a minute" while a generation turn is pending, else "no quiz plan yet, run a primer first". A video that belongs to no course gets a plain 404 and the extension stays silent.
- `GET /reviews/due`: the same payload as `get_due_reviews`.
- `GET /grades/:outcomeId`: the grade for one outcome, or 404. The browser extension polls it for up to 90 seconds after an explain-back.
- `POST /outcomes`: one outcome or an array of outcomes. `answeredAt` is required here, because the client supplies it to keep retries idempotent.
- `POST /logs`: forward client log lines into the server log file.

## Server started agent turns

`LEARNING_AGENT` picks the driver: `claude` (default), `pi`, or `off`. `off` disables every server started turn, and the fallbacks in ADR 0002 carry the work. Turns run one at a time with a 5 minute timeout and no retries. Success is judged by state, never by agent prose: the grade or the quiz plan must exist after the turn.

- The `claude` driver runs `claude -p` in restricted mode with no setting sources, a strict MCP config that holds only the learning server, an allowlist of the learning tools plus read only file tools, and no session persistence. `--bare` is not usable, because it disables subscription auth. A grading turn measured about 6 seconds and 0.03 USD notional.
- The `pi` driver runs `pi -p` with only the `learning-tools.ts` extension, no skills, no context files, and the same tool allowlist.
- Grading: an `ungraded` explain-back from a surface other than the agent enqueues one turn. The learner's text goes into the prompt inside a random fence, labelled as untrusted data, and is never logged.
- Next quiz plan: recap quiz outcomes from the YouTube surface enqueue one generation turn for the next unit by roadmap order, debounced to about 20 seconds after the last recap outcome, so a burst yields one turn. No turn starts when the next unit already has a plan, when a turn for it is pending, or when the "visit the agent first" condition holds.
- Writes made through the agent tools never start a turn, so a turn cannot recurse.

## Milestones

1. bun, the `packages/` restructure, core schemas.
2. `prepare-course` skill: collect source material, build the roadmap.
3. Server (HTTP, MCP, logging, launchd) plus the pi extension that registers the same tools.
4. `primer` skill: probe prerequisites, teach gaps, generate a verified quiz plan.
5. Claude Code plugin packaging.
6. Browser extension: pause quiz, pre-question, recap quiz, flag, toasts.
7. Outcome ingest in `learning-progress` plus the `teach` edits. The loop is closed after this step.
8. Tier selection toward 85 percent.
9. Spaced review in the browser extension and on the agent surface.
10. Explain-back with harness-agnostic headless grading (`claude -p` and `pi -p` drivers).
11. Headless generation of the next unit's quiz plan after a recap quiz. If a prerequisite node was missed, a toast says to visit the agent first and no plan is generated.
12. Mobile surface: Expo, Tailscale, offline cache, one local notification per day, unsigned IPA sideload. Copy the skeleton and the `-core.ts` split from `vibe-tracker`.

### `teach` edits in milestone 7

Replace the original author's "he" framing with "the learner". Add the increment rule with the 85 percent target. Add "outcomes are the prior". Add a tool name mapping so the skill works on Claude Code, where `quiz` maps onto `AskUserQuestion`. Tune further from real sessions.
