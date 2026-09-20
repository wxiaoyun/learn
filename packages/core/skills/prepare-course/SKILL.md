---
name: prepare-course
description: Prepare a new Course from a playlist, website, PDF slides, textbook, or other Source material by collecting it and building an approved Roadmap. Use at Course start when the learner hands over Source material. Do not use for a quick explanation or an existing Course's Primer.
---

# Prepare Course

Preparation happens once, before the first Unit.

## Tool mapping

Use the learner-choice capability for goals, decisions, and approval. On pi use `ask_user_question`. On Claude Code use `AskUserQuestion`.

Use `put_roadmap` for the only Roadmap write. The name is the same on pi and Claude Code over MCP.

## Procedure

1. Interrogate the learner's goal before collecting Source material. Ask what they want to be able to do, why, desired scope and depth, exclusions, baseline, and observable completion criteria. Follow up until the goal is specific enough to decide Roadmap emphasis.
2. Choose the Course id and collect all Source material under its Course directory.
3. Read the collected Source material and draft one Roadmap entry per Unit in Source material order.
4. Present a short prose summary and a small Mermaid graph of Unit dependencies. Ask for approval and wait. Wrong scope is cheap to fix here.
5. After approval, call `put_roadmap` with the complete Roadmap.
6. Create the Course's `LEARNING.md` dashboard only after `put_roadmap` succeeds.
7. Hand off to the first Unit's Primer.

## Course id and Unit id

Use lowercase slugs matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Keep ids stable once created. Never rename a Course id or Unit id after Outcomes exist.

## Collect Source material

Set the paths, then keep every transcript, copied file, fetched page, and collection note under `sources/`:

```sh
ROOT="${LEARNING_ROOT:-$HOME/learning}"
COURSE_DIR="$ROOT/$COURSE_ID"
mkdir -p "$COURSE_DIR/sources/youtube"
```

Copy supplied documents without changing their originals. Save fetched website pages and extracted document text beside the originals. Preserve each original path or URL for `sourceMaterials[].reference` and each document Unit's `source.reference`.

For a YouTube playlist or single video, set `SOURCE_URL`. This verified command writes order, video ID, exact title, and duration in seconds:

```sh
yt-dlp --flat-playlist --dump-single-json "$SOURCE_URL" \
  | jq -r '(.entries // [.]) | to_entries[] | [.key + 1, .value.id, .value.title, .value.duration] | @tsv' \
  > "$COURSE_DIR/sources/youtube/playlist.tsv"
```

Set `CAPTION_LANG` to the Source material's language code. This verified command downloads VTT text and no video. With both caption flags, `yt-dlp` prefers human captions over same-language automatic captions.

```sh
yt-dlp --ignore-errors --skip-download --write-subs --write-auto-subs \
  --sub-langs "$CAPTION_LANG" --sub-format vtt \
  --output "$COURSE_DIR/sources/youtube/%(id)s.%(ext)s" \
  "$SOURCE_URL"
```

Record caption status for every listed video in `sources/youtube/captions.md`, including `none` when `yt-dlp` confirms no caption exists. A video without captions is not a blocker. Do not label network or extraction failures as `none`.

Treat written Source material as ground truth over automatic captions when terms, names, or formulas disagree.

## Build the Roadmap

Never invent Unit titles, `topics`, or order from memory. Trace every value to collected Source material. Create one Unit for each YouTube video, chapter, slide deck, or article. Keep `topics` coarse. Roadmap `topics` are labels, not Nodes.

Use one-based `order`. Set `dependsOn` to earlier Unit ids only when the Source material or required sequence supports that dependency. Use these exact shapes:

```json
{
  "courseId": "course-slug",
  "title": "Course title",
  "goal": "Learner goal",
  "sourceMaterials": [{ "title": "Source title", "reference": "URL or stored path" }],
  "units": [
    {
      "id": "unit-slug",
      "title": "Exact source title",
      "order": 1,
      "topics": ["coarse label"],
      "dependsOn": [],
      "kind": "youtube-video",
      "source": { "videoId": "video-id", "url": "https://www.youtube.com/watch?v=video-id" }
    }
  ]
}
```

For a document Unit, use `"kind": "document"` and `"source": { "reference": "URL or stored path" }`.

Do not create fine-grained Nodes or Quiz plans during Preparation. Each Unit's Primer creates them later. Earlier Outcomes change what later Units should ask, so far-ahead work is wasted.

## Approval and save

Show the Roadmap before saving. Keep the Mermaid graph small, with Unit ids as nodes and `dependsOn` as edges. Revise until the learner approves.

If `put_roadmap` says the learning server is unreachable, tell the learner plainly and stop. Never write JSON files by hand.

A YouTube video belongs to exactly one Course. If `put_roadmap` rejects a video ID owned by another Course, name that Course and ask the learner how to proceed. Do not retry with a hidden duplicate.

## Dashboard and handoff

Create `$COURSE_DIR/LEARNING.md` and `$COURSE_DIR/sessions/`. Keep the dashboard lean with Goal, Completion Criteria, Key Nodes, Unit Dependencies, Roadmap, Current Checkpoint, Knowledge State, Practice Artifacts, Session History, and References. Mark every Unit `[ ]`. State that Nodes are created by each Unit's Primer. Record no demonstrated Knowledge State and create no Session record before evidence exists.

Set Current Checkpoint to the first Unit. Set the next action to run that Unit's Primer. Tell the learner that the Primer is the next step in the Study loop.
