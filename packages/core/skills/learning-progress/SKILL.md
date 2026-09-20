---
name: learning-progress
description: Maintain a Course dashboard, Knowledge State, evidence, artifacts, Current Checkpoint, and Session records. Use when starting, resuming, or finishing a learning Session, or when creating a Course tracker.
---

# Learning State

Maintain durable learning state without turning the dashboard into a transcript.

This skill records learning. The `teach` skill governs how to teach.

## Storage Convention

Each Course uses:

```text
<course>/
├── LEARNING.md
└── sessions/
    └── YYYY-MM-DD-focus.md
```

`LEARNING.md` is the lean dashboard. Session files hold detailed evidence and history.

## Tool Mapping

Use the graded question capability for every prompt with a correct response. On pi use `quiz`. On Claude Code use `AskUserQuestion`, then grade in chat.

Use the learner-choice capability only for decisions without a correct response. On pi use `ask_user_question`. On Claude Code use `AskUserQuestion`.

Use the harness subagent capability with the `researcher` agent when Source material needs verification.

The typed tools `list_courses`, `get_course_state`, `get_outcomes`, `get_due_reviews`, `put_quiz_plan`, `append_outcome`, and `append_grade` have the same names on both harnesses.

## Resolve the Course

1. Call `list_courses` and match the active subject to a prepared Course.
2. A prepared Course lives at `<LEARNING_ROOT>/<courseId>`, where `LEARNING_ROOT` defaults to `~/learning`.
3. If several Courses are plausible, ask the learner which Course applies.
4. Only when no prepared Course matches, use the file fallback. Locate an existing `LEARNING.md`, or ask where the Course directory should live before creating one.
5. Never invent internal Course names when the intended terminology is unclear.

## Start or Resume a Session

After resolving a prepared Course, make `get_course_state { "courseId": "<courseId>" }` the first Session action.

1. If the learning server is unreachable, say so plainly. Skip the remaining server calls. Continue from the dashboard alone and clearly mark it as possibly stale.
2. Read `LEARNING.md` completely. Read the latest linked Session only when the dashboard lacks needed context.
3. Read `recentAsks` and `unansweredAsks` from the Course state. Treat each Ask as a confusion signal on its tagged Nodes. At the start of the Session, answer every unanswered Ask with `answer_ask` after reading the relevant Source material.
4. Read `Outcomes ingested through: <ISO timestamp>` from `Current Checkpoint`. Call `get_outcomes { "courseId": "<courseId>", "since": "<timestamp>" }`. Omit `since` when no watermark exists.
5. Ingest each new Outcome and Grade. Ignore records already ingested, including records exactly at the watermark. Then set the watermark to the latest ingested Outcome `answeredAt`. Preserve it when no newer Outcome exists. If no watermark and no Outcome exist, store `1970-01-01T00:00:00.000Z`.
6. Call `get_due_reviews { "courseId": "<courseId>" }`. Mention the streak in one short line, never more. If Nodes are due, offer to run them before continuing.
7. Continue from `Current Checkpoint` unless the learner chooses another Unit. Use Solid Nodes as the teaching floor.

Do not dump the dashboard back to the learner. State only the Current Checkpoint, new evidence that needs attention, and next useful action.

## Judge New Evidence

Judge Knowledge State per Node from the evidence itself, not from counts alone.

- Only application Tier Outcomes can promote a Node to `Solid`. Recall Tier Outcomes are warm-up.
- A single miss among correct Outcomes can be a careless slip. Repeated misses on the same Node, or repeated selection of the same wrong option, indicate a likely misconception.
- Preserve the existing distinction between a genuine gap and a careless mistake. Record uncertainty as `Developing` until evidence resolves it.
- `skipped` and `flagged` Outcomes are never evidence about the learner.
- An Explain-back grade is a Node-level judgment. An `understood` grade for an application Tier Explain-back may support `Solid`.
- An Ask is never correct or wrong. An Ask never promotes or demotes a Node by itself. Repeated recent Asks on one Node are reason to mark it `Developing` and address it before moving on.

## Run Due Reviews

When the learner accepts due reviews, ask each returned Question with the graded question capability. Record it immediately through `append_outcome` with `surface` set to `agent`, its `tier`, and no `unitId`.

When `poolExhausted` is true, write fresh application Tier choice Questions for that Node before asking it. Use one fresh Question instead of the returned repeated Question. Use the `teach` option construction procedure. Verify every new Question against the relevant Source material with a `researcher` pass. Read the complete Quiz plan named by the returned `unitId`, add the Questions to that Node's pool, and call `put_quiz_plan` with the complete updated plan.

## Repair Flagged Questions

For each newly ingested flagged Question listed by `get_course_state`:

1. Locate it in `<LEARNING_ROOT>/<courseId>/quiz-plans/<unitId>.json` and inspect it against the relevant Source material.
2. Fix it or remove it from the Quiz plan, including every placement that names it.
3. Call `put_quiz_plan` with the complete corrected Quiz plan.
4. Tell the learner in one line what was wrong with the Question.

A flagged ad hoc Question has no Quiz plan to edit. Tell the learner what was wrong and do not treat its Outcome as evidence.

## Grade Explain-backs

For each ungraded Explain-back in `get_course_state`, read its Question, rubric, learner text, and relevant Source material. Call `append_grade` with a Node-level `judgment` and one sentence in `missing`. Never give a bare score. Tell the learner the judgment and what was missing.

## Record Evidence

Update the dashboard after a meaningful teaching block and before ending the Session.

Record only demonstrated learning. Acceptable evidence includes:

- correct application Tier Outcomes
- a correct Explain-back in the learner's own words
- completed exercises
- runnable code or other inspected work
- successful application to a new example

Watching, reading, or hearing an explanation is exposure, not evidence.

When evidence conflicts, keep the Node `Developing` and record the uncertainty.

## Keep `LEARNING.md` Lean

Use these sections:

```markdown
# Course Name

## Goal
## Completion Criteria
## Key Nodes
## Unit Dependencies
## Roadmap
## Current Checkpoint
## Knowledge State
## Practice Artifacts
## Session History
## References
```

Rules:

- Use `[ ]` for not started, `[>]` for active, and `[x]` for completed Units in the Roadmap.
- List Units, not Nodes, in `Roadmap`.
- Keep `Knowledge State` limited to `Solid`, `Developing`, and `Known gaps`.
- Keep `Current Checkpoint` limited to current Unit, last completed item, next action, blockers, and one `Outcomes ingested through: <ISO timestamp>` line.
- Link artifacts instead of copying their contents.
- Link each Session from `Session History` using a relative path.
- Do not store raw chat transcripts.
- Do not duplicate detailed Outcomes or notes from Session files.

## Write Session Records

Use one Session file per date and focus. Update an existing matching file instead of creating duplicates.

```markdown
# Session: Focus

Date: YYYY-MM-DD

## Covered
## Demonstrated Understanding
## Quiz Evidence
## Practice Completed
## Gaps and Misconceptions
## Next Action
```

Session rules:

- Record concise evidence, not praise or narrative filler.
- Distinguish genuine knowledge gaps from careless mistakes.
- Preserve important learner notes attached to Outcomes.
- Record misconceptions separately from missing vocabulary.
- Record notable Asks under `Gaps and Misconceptions`, with their Node ids and the useful part of each Answer.
- Link created files with paths relative to the Session file.
- Make `Next Action` specific enough for another agent to resume immediately.

## Update Order

At Session end:

1. Write or update the Session record.
2. Update Roadmap status only when evidence supports the change.
3. Refresh `Knowledge State` and the Outcome watermark.
4. Add or update artifact links.
5. Set one concrete next action.
6. Add the Session link if absent.
7. Verify every relative link points to an existing file.
8. Hand off to `teach` first when a Node needs repair. Otherwise hand off to `primer` for the next Unit.

## New Course Setup

For a new Course:

1. Gather the learner's goal and baseline before finalizing the Roadmap.
2. Map Key Nodes and Unit Dependencies.
3. Define observable completion criteria.
4. Create `LEARNING.md` and `sessions/`.
5. Add the first Session record after evidence exists.
6. Check the nearest `AGENTS.md` for the storage convention.
7. If missing, propose a minimal generic reference before editing `AGENTS.md`.

Do not create extra indexes, databases, schemas, or automation until the Markdown structure becomes insufficient.

## Integrity Checks

Before reporting completion, verify:

- dashboard and linked Session files exist
- Current Checkpoint matches Roadmap status
- completed Units have evidence
- Known gaps are not marked Solid
- next action is concrete
- relative links resolve
