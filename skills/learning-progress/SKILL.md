---
name: learning-progress
description: Persistently tracks a learner's roadmap, objectives, topic dependencies, demonstrated understanding, gaps, artifacts, current checkpoint, and detailed session records. Use when starting, resuming, or finishing a learning session, when the user asks to track or update learning progress, or when creating a structured course tracker.
---

# Learning Progress

Maintain durable learning state without turning the main tracker into a transcript.

This skill records learning. The `teach` skill governs how to teach.

## Storage Convention

Each course uses:

```text
<course>/
├── LEARNING.md
└── sessions/
    └── YYYY-MM-DD-topic.md
```

`LEARNING.md` is the lean dashboard. Session files hold detailed evidence and history.

## Resolve the Course

1. Search the workspace for `LEARNING.md` files.
2. Match the active subject to an existing course tracker.
3. If several trackers are plausible, ask the user which course applies.
4. If no tracker exists, ask where the course directory should live before creating it.
5. Never invent internal course names when the intended terminology is unclear.

## Start or Resume a Session

1. Read the course's `LEARNING.md` completely.
2. Read the latest linked session only when the dashboard lacks needed context.
3. Continue from `Current Checkpoint` unless the user chooses another topic.
4. Use established knowledge as the lesson floor.
5. Probe known gaps before assuming they remain unresolved.

Do not dump the tracker back to the user. State only the current checkpoint and next useful action.

## Record Progress

Update progress after a meaningful learning block and before ending the session.

Record only demonstrated learning. Acceptable evidence includes:

- correct quiz answers that test understanding
- a correct explanation in the learner's own words
- completed exercises
- runnable code or other inspected work
- successful application to a new example

Watching, reading, or hearing an explanation is exposure, not completion.

When evidence conflicts, keep the objective in progress and record the uncertainty.

## Keep `LEARNING.md` Lean

Use these sections:

```markdown
# Course Name

## Goal
## Completion Criteria
## Key Learning Objectives
## Topic Dependencies
## Roadmap
## Current Checkpoint
## Knowledge State
## Practice Artifacts
## Session History
## References
```

Rules:

- Use `[ ]` for not started, `[>]` for in progress, and `[x]` for completed.
- Keep `Knowledge State` limited to `Solid`, `Developing`, and `Known gaps`.
- Keep `Current Checkpoint` limited to current module, last completed item, next action, and blockers.
- Link artifacts instead of copying their contents.
- Link each session from `Session History` using a relative path.
- Do not store raw chat transcripts.
- Do not duplicate detailed quiz results or notes from session files.

## Write Session Records

Use one session file per date and topic. Update an existing matching file instead of creating duplicates.

```markdown
# Session: Topic

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
- Preserve important learner notes attached to quiz answers.
- Record misconceptions separately from missing vocabulary.
- Link created files with paths relative to the session file.
- Make `Next Action` specific enough for another agent to resume immediately.

## Update Order

At session end:

1. Write or update the session record.
2. Update roadmap status only when evidence supports the change.
3. Refresh `Knowledge State`.
4. Add or update artifact links.
5. Set one concrete next action.
6. Add the session link if absent.
7. Verify every relative link points to an existing file.

## New Course Setup

For a new course:

1. Gather the learner's goal and baseline before finalizing the roadmap.
2. Map prerequisites and topic dependencies.
3. Define observable completion criteria.
4. Create `LEARNING.md` and `sessions/`.
5. Add the first session record after evidence exists.
6. Check the nearest `AGENTS.md` for the storage convention.
7. If missing, propose a minimal generic reference before editing `AGENTS.md`.

Do not create extra indexes, databases, schemas, or automation until the Markdown structure becomes insufficient.

## Integrity Checks

Before reporting completion, verify:

- dashboard and linked session files exist
- current checkpoint matches roadmap status
- completed items have evidence
- known gaps are not marked solid
- next action is concrete
- relative links resolve
