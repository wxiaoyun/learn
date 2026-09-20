import { placementKey, type GradeOutcome, type OutcomeInput, type Placement, type QuizPlan } from "@learn/core"

export type TimedPlacement = {
  index: number
  seconds: number
  placementKey: string
  questionIds: readonly string[]
}

export type PlaybackStep = {
  trigger?: TimedPlacement
  passed: readonly TimedPlacement[]
  jumped: boolean
}

export type PlacementOutcome = Pick<OutcomeInput, "placementKey" | "questionId" | "status">

export function completedPlacementKeys(
  placements: readonly Placement[],
  answeredPlacementKeys: ReadonlySet<string>,
  sessionOutcomes: readonly PlacementOutcome[],
): Set<string> {
  const completed = new Set(answeredPlacementKeys)
  for (const placement of placements) {
    if (placement.kind === "recap") continue
    const key = placementKey(placement)
    const answered = new Set(sessionOutcomes
      .filter((outcome) => outcome.placementKey === key && outcome.status !== "skipped")
      .map((outcome) => outcome.questionId))
    const count = placement.kind === "pre-question" ? 1 : placement.questionIds.length
    if (answered.size >= count) completed.add(key)
  }
  return completed
}

function questionIds(placement: Placement): readonly string[] {
  if (placement.kind === "pre-question") return [placement.questionId]
  if (placement.kind === "pause") return placement.questionIds
  return []
}

function seconds(placement: Placement): number | undefined {
  if (placement.kind === "pre-question") {
    return placement.location?.anchor.kind === "video-timestamp"
      ? placement.location.anchor.seconds
      : undefined
  }
  return placement.kind === "pause" && placement.location.anchor.kind === "video-timestamp"
    ? placement.location.anchor.seconds
    : undefined
}

export function timedPlacements(placements: readonly Placement[]): TimedPlacement[] {
  return placements.flatMap((placement, index) => {
    const value = seconds(placement)
    return value === undefined
      ? []
      : [{ index, seconds: value, placementKey: placementKey(placement), questionIds: questionIds(placement) }]
  }).sort((left, right) => left.seconds - right.seconds)
}

export function playbackStep(input: {
  previousTime: number
  currentTime: number
  playbackRate: number
  seeking: boolean
  placements: readonly Placement[]
  answeredPlacementKeys: ReadonlySet<string>
  sessionOutcomes: readonly PlacementOutcome[]
}): PlaybackStep {
  const completed = completedPlacementKeys(
    input.placements,
    input.answeredPlacementKeys,
    input.sessionOutcomes,
  )
  const delta = input.currentTime - input.previousTime
  const jumped = input.seeking || delta < 0 || delta > Math.max(2, Math.abs(input.playbackRate) * 2)
  const crossed = timedPlacements(input.placements).filter((placement) =>
    placement.seconds > input.previousTime
    && placement.seconds <= input.currentTime
    && !completed.has(placement.placementKey))
  return jumped
    ? { passed: delta > 0 ? crossed : [], jumped: true }
    : { trigger: crossed[0], passed: [], jumped: false }
}

export function recapQuestionIds(input: {
  plan: QuizPlan
  answeredQuestionIds: ReadonlySet<string>
  answeredPlacementKeys: ReadonlySet<string>
  sessionOutcomes: readonly PlacementOutcome[]
  missedQuestionIds: ReadonlySet<string>
}): { choiceQuestionIds: string[]; explainBackQuestionId?: string } {
  const recap = input.plan.placements.find((placement) => placement.kind === "recap")
  if (!recap) return { choiceQuestionIds: [] }
  const completed = completedPlacementKeys(
    input.plan.placements,
    input.answeredPlacementKeys,
    input.sessionOutcomes,
  )

  const earlier = input.plan.placements.flatMap((placement) => {
    if (placement.kind === "recap") return []
    const ids = placement.kind === "pre-question" ? [placement.questionId] : placement.questionIds
    return completed.has(placementKey(placement))
      ? ids.filter((id) => input.missedQuestionIds.has(id))
      : ids
  })
  const missed = input.plan.questionPool
    .filter((question) => question.kind === "choice" && input.missedQuestionIds.has(question.id))
    .map((question) => question.id)
  const priority = new Set([...earlier, ...missed])
  const ordered = [...priority, ...recap.questionIds].filter((id, index, values) =>
    values.indexOf(id) === index
    && (priority.has(id) || !input.answeredQuestionIds.has(id)))
  return {
    choiceQuestionIds: ordered.slice(0, 8),
    explainBackQuestionId: input.answeredQuestionIds.has(recap.explainBackQuestionId)
      ? undefined
      : recap.explainBackQuestionId,
  }
}

export function landedNodeIds(plan: QuizPlan, correctQuestionIds: ReadonlySet<string>): Set<string> {
  return new Set(plan.questionPool
    .filter((question) => question.tier === "application" && correctQuestionIds.has(question.id))
    .map((question) => question.nodeId))
}

export function gradeToast(grade: Pick<GradeOutcome, "judgment" | "missing">): string {
  const judgment = grade.judgment === "understood"
    ? "Understood"
    : grade.judgment === "partial" ? "Partly understood" : "Not understood"
  return `${judgment}. ${grade.missing}`
}
