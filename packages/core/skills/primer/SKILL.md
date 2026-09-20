---
name: primer
description: Run the Primer when the learner is about to start or continue one Unit of a prepared Course, including when they say "continue" in a Course directory. Do not use for an unprepared one-off request, which belongs to teach alone.
---

# Primer

A Primer runs once immediately before one Unit. It readies the learner and creates only that Unit's Quiz plan.

## Tool mapping

Use the graded question capability for every prompt with a correct response. On pi use `quiz`. On Claude Code use `AskUserQuestion`, then grade in chat.

Use the learner-choice capability only for decisions without a correct response. On pi use `ask_user_question`. On Claude Code use `AskUserQuestion`.

Use the harness subagent capability with the `researcher` agent for verification. If no researcher implementation exists, use a separate careful pass.

The typed tools `get_course_state`, `put_nodes`, `put_quiz_plan`, `append_outcome`, and `append_grade` have the same names on both harnesses.

## Procedure

1. Call `get_course_state` with `{ "courseId": "<courseId>" }`. Select the Current Checkpoint Unit unless the learner names another Unit. If its Quiz plan has any Question with an Outcome, do not regenerate it. Ask what the learner wants without revealing its Questions.
2. Read the Unit's collected Source material. For a YouTube Unit, read `<LEARNING_ROOT>/<courseId>/sources/youtube/<videoId>.<lang>.vtt` and any slides or written Source material covering the same ground. Treat slides and written Source material as ground truth over automatic captions.
3. Split the Unit's knowledge into `ASSUMES` and `TEACHES`. `ASSUMES` contains prerequisite Nodes, including Nodes absent from `nodes.json`. `TEACHES` contains only Nodes established by this Unit. Give each new Node a stable slug, title, one or two sentence summary, `dependsOn`, and `taughtAt`. Use the transcript cue where the Unit finishes establishing the Node, in seconds, or the document page.
4. Treat Outcomes as the prior for Knowledge State and `teach`. Read each entry in `nodeSummaries` by `nodeId`. Its fields are `counts.recall.correct`, `counts.recall.wrong`, `counts.application.correct`, `counts.application.wrong`, `latestOutcomeAt`, `latestCorrectApplicationAt`, `latestWrongAt`, `askCount`, and `latestAskAt`. Recent means a `latestCorrectApplicationAt` within 21 days with no `latestWrongAt` after it. A Node with an Ask in the last 14 days has conflicting evidence, even when it also has a recent correct application Outcome. Probe it. If either wrong count is nonzero and `latestCorrectApplicationAt` is absent, send the gap directly to the `teach` loop. Probe all other Nodes without recent evidence, including zero counts, stale evidence, or a later miss. Reuse `teach` Phase 1 for probes and Phase 2 and Phase 3 for gaps. Never restate that skill's philosophy or process here. Do not pre-teach any Node in `TEACHES`.
5. Record every gradable Question asked on the Agent surface through `append_outcome` with `{ "outcome": <AgentOutcomeInput> }`. Set `surface` to `agent` and set its `tier`. Ad hoc Outcomes carry `tier` because they have no stored Quiz plan. Omit `id`. Omit `answeredAt` to let the server use the current time, or include it inside `outcome` as an ISO date-time. Record probe, teaching, document Pre-question, Recap quiz, and Explain-back Outcomes immediately. Grade an ad hoc Explain-back in the same Session, immediately after asking it, and record the Grade through `append_grade`.
6. Call `put_nodes` with `{ "courseId": "<courseId>", "nodes": <complete Nodes array> }`. It is a validated full replace. Never drop or rename an existing Node id. For an assumed Node not taught by any Course Unit, use an empty `taughtAt` array.
7. Build one Quiz plan for this Unit. For every taught Node, create several source-grounded choice Questions across both Tiers, with at least one `recall` and one `application`. Every Question names exactly one Node. Question ids are unique across the whole Course, so prefix each one with the Unit id. Keep unseen Questions in the pool for Spaced review.
8. Place one Pre-question per major segment. For a `youtube-video` Unit, require its `location` at the timestamp where the segment that teaches its Node begins. Put Pause quizzes at Node boundaries using `taughtAt`, never merely by elapsed time, with one or two Questions each. Make the Recap quiz five to eight choice Questions, application heavy, with currently unanswered and missed Questions first, followed by one Explain-back with a grading rubric. Across choice Questions shown by placements, target about 60 percent recall and 40 percent application. Build every choice set with the `teach` skill's "Writing quiz options" construction procedure. Vary the position of the correct option across Questions. A fixed position is a tell.
9. Give the Source material and draft Quiz plan to a `researcher` pass. Check every prompt, correct option, explanation, and rubric claim against the Source material. Fix or drop anything untraceable. Keep trace notes outside the payload because the schema rejects extra fields.
10. Call `put_quiz_plan` with `{ "courseId": "<courseId>", "unitId": "<unitId>", "plan": <Quiz plan> }`. On a validation error, fix the Quiz plan and retry. Never write JSON by hand. If the learning server is unreachable, say so plainly and stop. Never show Quiz plan Questions to the learner.
11. For a `youtube-video` Unit, tell the learner to go watch it. Say the browser extension will find the Quiz plan by video ID. For a `document` Unit, ask the Pre-questions now, record their Outcomes, tell the learner to work through the Unit, and say the Recap quiz will run on the Agent surface when they return. On return, use the graded question capability for each Recap placement Question, append each Outcome, then ask the Explain-back and append its `ungraded` Outcome. Grade it in the same Session immediately after asking it. Call `append_grade` with `{ "courseId": "<courseId>", "grade": <GradeOutcomeInput> }` and no `id`.

## Valid payload shapes

A Location uses one of these anchors. Video seconds are nonnegative numbers. Document pages are positive integers.

```json
{"unitId":"dot-products","anchor":{"kind":"video-timestamp","seconds":420}}
```

```json
{"unitId":"chapter-two","anchor":{"kind":"page","page":12}}
```

The `nodes` field for `put_nodes` receives this array. Node ids and dependencies are lowercase slugs. Dependencies must exist in the same array, ids must be unique, and the graph must be acyclic.

```json
[
  {"id":"vectors","title":"Vectors","summary":"A vector has magnitude and direction.","dependsOn":[],"taughtAt":[{"unitId":"vector-basics","anchor":{"kind":"video-timestamp","seconds":300}}]},
  {"id":"dot-product","title":"Dot product","summary":"The dot product combines paired coordinates into a scalar. Its sign and magnitude encode geometric alignment.","dependsOn":["vectors"],"taughtAt":[{"unitId":"dot-products","anchor":{"kind":"video-timestamp","seconds":420}}]}
]
```

A choice Question has a slug `id`, slug `nodeId`, Tier, nonempty `prompt`, at least two unique `options`, an in-range zero-based `correctIndex`, and a nonempty `explanation`. An Explain-back replaces the last three choice fields with a nonempty `rubric`. Question ids must be unique, each `nodeId` must appear in the unique plan `nodeIds`, and every declared Node needs both Tiers.

A Pre-question placement names one choice Question and accepts an optional Location for the plan Unit. This skill requires that Location for a `youtube-video` Unit. A Pause quiz placement has a Location for the plan Unit, at least one declared `nodeId`, and one or two choice Questions whose Nodes it covers. Pre-question and Pause quiz placements reject Explain-backs. A Recap quiz placement names five to eight choice Questions and one Explain-back. The schema permits at most one Recap quiz and an empty `placements` array, but this procedure requires one Recap quiz.

```json
{
  "courseId":"linear-algebra",
  "unitId":"dot-products",
  "nodeIds":["dot-product"],
  "questionPool":[
    {"id":"dot-product-form","nodeId":"dot-product","tier":"recall","prompt":"Which expression defines the dot product of coordinate vectors?","kind":"choice","options":["The sum of paired coordinate products","The product of the coordinate sums","The sum of all coordinate squares"],"correctIndex":0,"explanation":"The dot product multiplies corresponding coordinates and adds those products."},
    {"id":"dot-product-output","nodeId":"dot-product","tier":"recall","prompt":"What kind of value does a dot product produce?","kind":"choice","options":["A vector","A scalar","A matrix"],"correctIndex":1,"explanation":"A dot product maps two vectors to one scalar."},
    {"id":"dot-product-orthogonal","nodeId":"dot-product","tier":"recall","prompt":"What is true when two nonzero vectors are orthogonal?","kind":"choice","options":["Their dot product is one","Their magnitudes are equal","Their dot product is zero"],"correctIndex":2,"explanation":"Orthogonal vectors have a cosine of zero, so their dot product is zero."},
    {"id":"dot-product-order","nodeId":"dot-product","tier":"recall","prompt":"How does swapping the two vectors affect their dot product?","kind":"choice","options":["The value stays the same","The sign always changes","The value becomes zero"],"correctIndex":0,"explanation":"Multiplication of paired coordinates is commutative, so the dot product is commutative."},
    {"id":"dot-product-positive","nodeId":"dot-product","tier":"recall","prompt":"What does a positive dot product indicate about the smaller angle between nonzero vectors?","kind":"choice","options":["The angle is right","The angle is acute","The angle is obtuse"],"correctIndex":1,"explanation":"A positive dot product means the cosine of the angle is positive, which makes the angle acute."},
    {"id":"dot-product-compute","nodeId":"dot-product","tier":"application","prompt":"What is the dot product of (2, 3) and (4, -1)?","kind":"choice","options":["7","11","5"],"correctIndex":2,"explanation":"Multiply paired coordinates and add them: 2 times 4 plus 3 times -1 equals 5."},
    {"id":"dot-product-perpendicular","nodeId":"dot-product","tier":"application","prompt":"Which pair is perpendicular?","kind":"choice","options":["(1, 2) and (2, -1)","(1, 2) and (2, 1)","(1, 2) and (-1, 2)"],"correctIndex":0,"explanation":"The first pair has dot product 1 times 2 plus 2 times -1, which is zero."},
    {"id":"dot-product-angle","nodeId":"dot-product","tier":"application","prompt":"Vectors have dot product -6. What can you conclude about their smaller angle?","kind":"choice","options":["It is acute","It is obtuse","It is right"],"correctIndex":1,"explanation":"A negative dot product means a negative cosine, so the smaller angle is obtuse."},
    {"id":"dot-product-projection","nodeId":"dot-product","tier":"application","prompt":"For a=(3, 4) and b=(1, 0), what is the scalar coefficient of a projected onto b?","kind":"choice","options":["4","5","3"],"correctIndex":2,"explanation":"The coefficient is a dot b divided by b dot b, which is 3 divided by 1."},
    {"id":"dot-product-work","nodeId":"dot-product","tier":"application","prompt":"A force (5, 0) moves an object by (3, 2). What work does the force do?","kind":"choice","options":["10","15","25"],"correctIndex":1,"explanation":"Work is force dot displacement, so 5 times 3 plus 0 times 2 equals 15."},
    {"id":"dot-product-explain","nodeId":"dot-product","tier":"application","prompt":"Explain why a zero dot product identifies perpendicular nonzero vectors.","kind":"explain-back","rubric":"The explanation must connect the dot product formula to the cosine of the angle and state that cosine zero means a right angle."}
  ],
  "placements":[
    {"kind":"pre-question","questionId":"dot-product-form","location":{"unitId":"dot-products","anchor":{"kind":"video-timestamp","seconds":360}}},
    {"kind":"pause","location":{"unitId":"dot-products","anchor":{"kind":"video-timestamp","seconds":420}},"nodeIds":["dot-product"],"questionIds":["dot-product-output","dot-product-orthogonal"]},
    {"kind":"recap","questionIds":["dot-product-order","dot-product-positive","dot-product-compute","dot-product-perpendicular","dot-product-angle"],"explainBackQuestionId":"dot-product-explain"}
  ]
}
```

`append_outcome` accepts the wrapper below. Its `outcome` is an `AgentOutcomeInput`: Course, Unit when present, Question, and Node ids are slugs. Surface is `youtube`, `agent`, or `mobile`. Status is `correct`, `wrong`, `skipped`, `flagged`, or `ungraded`. `unitId`, nonnegative `chosenIndex`, nonempty `text`, nonempty `learnerNote`, and valid ISO `answeredAt` are optional. Never combine `chosenIndex` and `text`. Never send `id`.

```json
{"outcome":{"type":"outcome","courseId":"linear-algebra","unitId":"dot-products","questionId":"probe-vector-addition","nodeId":"vectors","tier":"recall","surface":"agent","status":"correct","chosenIndex":1}}
```
