# Learning System

A personal system that teaches one learner through small, quiz-checked steps and keeps one model of what the learner knows across every place they study.

## Language

### Knowledge

**Node**:
One unit of knowledge in a course's dependency graph, identified by a stable slug. Every question tests exactly one node.
_Avoid_: Topic, concept, objective

**Edge**:
A dependency between two nodes, where one node is derivable from or rests on the other.

**Unconditional truth**:
A node the learner can accept at face value with no caveats.
_Avoid_: Axiom (unless the node follows from nothing else)

**Knowledge State**:
The learner's demonstrated standing on each node of a course, judged from evidence.
_Avoid_: Progress, mastery, score

### Courses

**Course**:
A bounded subject the learner is working through, with its own goal, node graph, and history.

**Source material**:
The playlist, slides, course website, textbook, and other inputs the learner hands to the agent for a course.
_Avoid_: Resources, content

**Unit**:
One piece of source material the learner works through in one sitting: a video, a chapter, a slide deck, an article.
_Avoid_: Lesson, module, video (when the rule holds for any source)

**Preparation**:
The agent's one-time reading of source material at course start, which produces the roadmap.
_Avoid_: Ingestion, indexing

**Roadmap**:
The coarse ordered outline of a course: one entry per unit, with its topics and what it depends on. The learner approves it before study begins.
_Avoid_: Syllabus, plan

**Primer**:
The agent session before a unit that probes the nodes the unit assumes, teaches any gaps, and produces that unit's quiz plan.
_Avoid_: Pre-flight, warm-up

**Study loop**:
The repeating cycle of primer, then learn, then return: the agent readies the learner for a unit, the learner works through the unit on whichever surface fits it, and the outcomes come back to the agent.

**Checkpoint**:
The learner's resume position within a course.
_Avoid_: Using this word for a quiz in the middle of a unit

**Session**:
One sitting of teaching on an agent surface, with a written record of evidence.

### Surfaces

**Surface**:
A place where the system meets the learner.
_Avoid_: Client, frontend, integration

**Agent surface**:
A coding agent that teaches interactively. pi and Claude Code are agent surfaces.

**YouTube surface**:
The browser extension that plays quiz plans over YouTube videos.

**Mobile surface**:
The iOS app that delivers spaced review on the learner's phone.

**pi extension**:
A TypeScript module loaded by pi that adds tools or UI to the agent surface.
_Avoid_: Bare "extension"

**Browser extension**:
The Chrome extension that implements the YouTube surface.
_Avoid_: Bare "extension", plugin

### Quizzing

**Question**:
One gradable prompt with options, a correct answer, and an explanation, tied to one node.

**Quiz plan**:
The set of questions the agent prepared for one unit, each anchored to a location in it, such as a video timestamp or a page.

**Pause quiz**:
Questions shown partway through a unit at a node boundary, interrupting it. On the YouTube surface the video pauses.
_Avoid_: Checkpoint quiz

**Pre-question**:
A question asked before the unit teaches its node, so the learner predicts first.

**Recap quiz**:
Questions shown at the end of a unit that revisit its nodes, missed and skipped items first.
_Avoid_: Summary quiz, final quiz

**Explain-back**:
An open-ended prompt where the learner explains a node in their own words, graded by the agent rather than by a stored answer.
_Avoid_: Free response, essay question

**Tier**:
The difficulty level of a question within a node's pool. Recall tiers warm up, application tiers count as evidence of understanding.

**Outcome**:
One recorded result for one question: correct, wrong, skipped, flagged, or awaiting a grade.
_Avoid_: Result, answer, score

**Flag**:
The learner's report that a question itself is wrong or unclear. A flagged outcome never counts toward Knowledge State.

**Spaced review**:
Re-testing a node after growing intervals of days to keep it from fading.
_Avoid_: Revision, flashcards
