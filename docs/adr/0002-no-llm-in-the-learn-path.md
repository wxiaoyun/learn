---
status: accepted
---

# No LLM in the learn path

While the learner works through a unit, nothing waits on a model. The agent writes each unit's quiz plan ahead of time, during that unit's primer, with a pool of questions per node across difficulty tiers. At learn time the authored questions of each placement stand. Difficulty adapts between units through the next primer, which sees the fresh outcomes.

We generate one unit's quiz plan at a time, not the whole course upfront. Outcomes from earlier units change what later quiz plans should ask, so plans written far ahead are wasted compute.

Agent turns started by the server are an optional enhancement and always have a fallback. Grading an explain-back falls back to the next interactive session. Generating the next unit's quiz plan after a recap quiz falls back to the learner running a primer. These turns run headless through one server function with two drivers, `claude -p` and `pi -p`, and the agent returns its result through the same typed tools as any other write, so nothing parses agent prose.

An ask is the one place where the learner waits on a model, and it does not break this decision. The rule is that nothing the system does on its own makes the learner wait. An ask is started by the learner, who chooses the wait, and the unit keeps playing if they resume. It uses the same headless turn function and the same fallback idea: with agent turns off, the ask box says so.

## Considered Options

- **Fully live generation.** Every question generated on demand. Rejected because learning would block on agent latency and uptime, and each question would cost a turn.
- **Learn-time tier selection toward 85 percent success.** A plain rule re-picked questions from the pool using the last 10 graded outcomes. Built, then removed. The target comes from a study of gradient-descent learners, not of a person learning concepts. In real use the learner scored 7 of 7 on choice questions and still hit a jump at the explain-back, so the rate never saw the problem. Re-picking also breaks the authored order of a node's questions, which now carries the difficulty ramp. The goal is learning the learner can sustain, not a rate.
- **Mid-unit live revision.** A warm agent rewrites upcoming pause quizzes after each one. Dropped once quiz plans became per-unit, because each plan is already written from fresh outcomes.
- **herdr with interactive Claude Code as the turn mechanism.** herdr is a terminal multiplexer, so replies come from screen scraping or re-reading session files, readiness detection is imprecise, trust dialogs block a child until a human answers, and a herdr server must already be running. It stays documented as a fallback in case headless usage on a subscription becomes separately metered. Anthropic announced that change for 2026-06-15 and paused it the same day. `herdr-agents` (`packages/core/src/herdr.ts`, `session.ts`) already holds the hard parts to copy.

## Consequences

- A wrong pre-generated answer would silently teach an error. Every quiz plan gets a verification pass against the source material before it is saved, and every surface offers a flag action whose outcomes never count toward Knowledge State.
- Headless turns draw from the same subscription limits as interactive work, so they run with a lean config and are batched, one turn per recap quiz, never one per question.
