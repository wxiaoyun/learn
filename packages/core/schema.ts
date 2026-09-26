import * as Schema from "effect/Schema"

const nonEmptyString = Schema.String.check(Schema.isMinLength(1))
const nonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const positiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))

export const SlugSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: "must be a lowercase slug" }),
)

export const YouTubeSourceSchema = Schema.Struct({
  videoId: nonEmptyString,
  url: Schema.String.check(
    Schema.isPattern(/^https?:\/\//, { message: "must be an HTTP URL" }),
  ),
})

export const DocumentSourceSchema = Schema.Struct({
  reference: nonEmptyString,
})

export const SourceMaterialSchema = Schema.Struct({
  title: nonEmptyString,
  reference: nonEmptyString,
})

const unitFields = {
  id: SlugSchema,
  title: nonEmptyString,
  order: nonNegativeInteger,
  topics: Schema.Array(nonEmptyString),
  dependsOn: Schema.Array(SlugSchema),
}

export const YouTubeUnitSchema = Schema.Struct({
  ...unitFields,
  kind: Schema.Literal("youtube-video"),
  source: YouTubeSourceSchema,
})

export const DocumentUnitSchema = Schema.Struct({
  ...unitFields,
  kind: Schema.Literal("document"),
  source: DocumentSourceSchema,
})

export const UnitSchema = Schema.Union([YouTubeUnitSchema, DocumentUnitSchema])

export const RoadmapSchema = Schema.Struct({
  courseId: SlugSchema,
  title: nonEmptyString,
  goal: nonEmptyString,
  sourceMaterials: Schema.Array(SourceMaterialSchema).check(Schema.isMinLength(1)),
  units: Schema.Array(UnitSchema).check(Schema.isMinLength(1)),
}).check(
  Schema.makeFilter((roadmap) => {
    const issues: Schema.FilterIssue[] = []
    const unitIds = new Set<string>()
    const videoIds = new Set<string>()
    roadmap.units.forEach((unit, index) => {
      if (unitIds.has(unit.id)) issues.push({ path: ["units", index, "id"], issue: "must be unique" })
      unitIds.add(unit.id)
      if (unit.kind === "youtube-video") {
        if (videoIds.has(unit.source.videoId)) {
          issues.push({
            path: ["units", index, "source", "videoId"],
            issue: "must be unique within the course",
          })
        }
        videoIds.add(unit.source.videoId)
      }
    })
    return issues
  }),
)

export const VideoTimestampAnchorSchema = Schema.Struct({
  kind: Schema.Literal("video-timestamp"),
  seconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
})

export const PageAnchorSchema = Schema.Struct({
  kind: Schema.Literal("page"),
  page: positiveInteger,
})

export const LocationSchema = Schema.Struct({
  unitId: SlugSchema,
  anchor: Schema.Union([VideoTimestampAnchorSchema, PageAnchorSchema]),
})

function sentenceCount(value: string): number {
  return value.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length
}

const oneOrTwoSentences = nonEmptyString.check(
  Schema.makeFilter((value) => sentenceCount(value) <= 2 || "must be one or two sentences"),
)

const oneSentence = nonEmptyString.check(
  Schema.makeFilter((value) => sentenceCount(value) === 1 || "must be one sentence"),
)

export const NodeSchema = Schema.Struct({
  id: SlugSchema,
  title: nonEmptyString,
  summary: oneOrTwoSentences,
  dependsOn: Schema.Array(SlugSchema),
  taughtAt: Schema.Array(LocationSchema),
})

export const NodesSchema = Schema.Array(NodeSchema).check(
  Schema.makeFilter((nodes) => {
    const issues: Schema.FilterIssue[] = []
    const byId = new Map(nodes.map((node, index) => [node.id, { node, index }]))
    const seen = new Set<string>()

    nodes.forEach((node, index) => {
      if (seen.has(node.id)) issues.push({ path: [index, "id"], issue: "must be unique" })
      seen.add(node.id)
      node.dependsOn.forEach((dependency, dependencyIndex) => {
        if (!byId.has(dependency)) {
          issues.push({
            path: [index, "dependsOn", dependencyIndex],
            issue: `names missing node "${dependency}"`,
          })
        }
      })
    })

    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string): void => {
      if (visited.has(id)) return
      const entry = byId.get(id)
      if (!entry) return
      visiting.add(id)
      entry.node.dependsOn.forEach((dependency, dependencyIndex) => {
        if (!byId.has(dependency)) return
        if (visiting.has(dependency)) {
          issues.push({
            path: [entry.index, "dependsOn", dependencyIndex],
            issue: `creates a cycle through node "${dependency}"`,
          })
          return
        }
        visit(dependency)
      })
      visiting.delete(id)
      visited.add(id)
    }

    nodes.forEach((node) => visit(node.id))
    return issues
  }),
)

const questionFields = {
  id: SlugSchema,
  nodeId: SlugSchema,
  tier: Schema.Literals(["recall", "application"]),
  prompt: nonEmptyString,
}

export const ChoiceQuestionSchema = Schema.Struct({
  ...questionFields,
  kind: Schema.Literal("choice"),
  options: Schema.Array(nonEmptyString).check(Schema.isMinLength(2)),
  correctIndex: nonNegativeInteger,
  explanation: nonEmptyString,
}).check(
  Schema.makeFilter((question) => {
    const issues: Schema.FilterIssue[] = []
    if (question.correctIndex >= question.options.length) {
      issues.push({ path: ["correctIndex"], issue: "must name an option" })
    }
    if (new Set(question.options).size !== question.options.length) {
      issues.push({ path: ["options"], issue: "must be unique" })
    }
    return issues
  }),
)

export const ExplainBackQuestionSchema = Schema.Struct({
  ...questionFields,
  kind: Schema.Literal("explain-back"),
  rubric: nonEmptyString,
})

export const QuestionSchema = Schema.Union([ChoiceQuestionSchema, ExplainBackQuestionSchema])

export const PreQuestionPlacementSchema = Schema.Struct({
  kind: Schema.Literal("pre-question"),
  questionId: SlugSchema,
  location: Schema.optional(LocationSchema),
})

export const PausePlacementSchema = Schema.Struct({
  kind: Schema.Literal("pause"),
  location: LocationSchema,
  nodeIds: Schema.Array(SlugSchema).check(Schema.isMinLength(1)),
  questionIds: Schema.Array(SlugSchema).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
})

export const RecapPlacementSchema = Schema.Struct({
  kind: Schema.Literal("recap"),
  questionIds: Schema.Array(SlugSchema).check(Schema.isMinLength(5), Schema.isMaxLength(8)),
  explainBackQuestionId: SlugSchema,
})

export const PlacementSchema = Schema.Union([
  PreQuestionPlacementSchema,
  PausePlacementSchema,
  RecapPlacementSchema,
])

export const MIN_PLACEMENT_GAP_SECONDS = 30

export const QuizPlanSchema = Schema.Struct({
  courseId: SlugSchema,
  unitId: SlugSchema,
  nodeIds: Schema.Array(SlugSchema).check(Schema.isMinLength(1)),
  questionPool: Schema.Array(QuestionSchema).check(Schema.isMinLength(1)),
  placements: Schema.Array(PlacementSchema),
}).check(
  Schema.makeFilter((plan) => {
    const issues: Schema.FilterIssue[] = []
    const declaredNodeIds = new Set(plan.nodeIds)
    const questions = new Map(plan.questionPool.map((question) => [question.id, question]))

    if (declaredNodeIds.size !== plan.nodeIds.length) {
      issues.push({ path: ["nodeIds"], issue: "must be unique" })
    }
    if (questions.size !== plan.questionPool.length) {
      issues.push({ path: ["questionPool"], issue: "question ids must be unique" })
    }

    plan.questionPool.forEach((question, index) => {
      if (!declaredNodeIds.has(question.nodeId)) {
        issues.push({
          path: ["questionPool", index, "nodeId"],
          issue: `names undeclared node "${question.nodeId}"`,
        })
      }
    })

    declaredNodeIds.forEach((nodeId) => {
      const tiers = new Set(
        plan.questionPool.filter((question) => question.nodeId === nodeId).map((question) => question.tier),
      )
      if (!tiers.has("recall") || !tiers.has("application")) {
        issues.push({
          path: ["questionPool"],
          issue: `node "${nodeId}" needs recall and application questions`,
        })
      }
    })

    const requireQuestion = (questionId: string, path: ReadonlyArray<PropertyKey>) => {
      const question = questions.get(questionId)
      if (!question) issues.push({ path, issue: `names missing question "${questionId}"` })
      return question
    }

    const recapCount = plan.placements.filter((placement) => placement.kind === "recap").length
    if (recapCount > 1) {
      issues.push({ path: ["placements"], issue: "must contain at most one recap quiz" })
    }

    const videoPlacements = plan.placements.flatMap((placement, index) => {
      if (placement.kind === "recap") return []
      const anchor = placement.location?.anchor
      if (!anchor || anchor.kind !== "video-timestamp") return []
      return [{ index, seconds: anchor.seconds }]
    })
    videoPlacements.forEach((placement, position) => {
      const previous = videoPlacements[position - 1]
      if (!previous) return
      if (placement.seconds - previous.seconds < MIN_PLACEMENT_GAP_SECONDS) {
        issues.push({
          path: ["placements", placement.index, "location", "anchor", "seconds"],
          issue: `must run in ascending order and at least ${MIN_PLACEMENT_GAP_SECONDS} seconds after the previous placement at ${previous.seconds}`,
        })
      }
    })

    plan.placements.forEach((placement, index) => {
      const path = ["placements", index] as const
      if (placement.kind === "pre-question") {
        const question = requireQuestion(placement.questionId, [...path, "questionId"])
        if (question?.kind === "explain-back") {
          issues.push({ path: [...path, "questionId"], issue: "must name a choice question" })
        }
        if (placement.location && placement.location.unitId !== plan.unitId) {
          issues.push({ path: [...path, "location", "unitId"], issue: "must match unitId" })
        }
      }
      if (placement.kind === "pause") {
        if (placement.location.unitId !== plan.unitId) {
          issues.push({ path: [...path, "location", "unitId"], issue: "must match unitId" })
        }
        placement.nodeIds.forEach((nodeId, nodeIndex) => {
          if (!declaredNodeIds.has(nodeId)) {
            issues.push({
              path: [...path, "nodeIds", nodeIndex],
              issue: `names undeclared node "${nodeId}"`,
            })
          }
        })
        placement.questionIds.forEach((questionId, questionIndex) => {
          const question = requireQuestion(questionId, [...path, "questionIds", questionIndex])
          if (question?.kind === "explain-back") {
            issues.push({
              path: [...path, "questionIds", questionIndex],
              issue: "must name a choice question",
            })
          }
          if (question && !placement.nodeIds.includes(question.nodeId)) {
            issues.push({
              path: [...path, "questionIds", questionIndex],
              issue: `question node "${question.nodeId}" is not covered by the placement`,
            })
          }
        })
      }
      if (placement.kind === "recap") {
        placement.questionIds.forEach((questionId, questionIndex) => {
          const question = requireQuestion(questionId, [...path, "questionIds", questionIndex])
          if (question?.kind === "explain-back") {
            issues.push({
              path: [...path, "questionIds", questionIndex],
              issue: "must name a choice question",
            })
          }
        })
        const explainBack = requireQuestion(placement.explainBackQuestionId, [
          ...path,
          "explainBackQuestionId",
        ])
        if (explainBack && explainBack.kind !== "explain-back") {
          issues.push({
            path: [...path, "explainBackQuestionId"],
            issue: "must name an explain-back question",
          })
        }
      }
    })

    return issues
  }),
)

export const SurfaceSchema = Schema.Literals(["youtube", "agent", "mobile", "browser"])
export const LogLevelSchema = Schema.Literals(["info", "warn", "error"])
export const ClientLogLineSchema = Schema.Struct({
  level: LogLevelSchema,
  stage: nonEmptyString,
  target: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  fields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export const ClientLogsSchema = Schema.Struct({
  surface: SurfaceSchema,
  lines: Schema.Array(ClientLogLineSchema).check(Schema.isMinLength(1)),
})
export const OutcomeStatusSchema = Schema.Literals([
  "correct",
  "wrong",
  "skipped",
  "flagged",
  "ungraded",
])
export const NodeJudgmentSchema = Schema.Literals(["understood", "partial", "not-understood"])

const isoDateTime = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, {
    message: "must be an ISO date-time",
  }),
  Schema.makeFilter((value) => {
    const [date] = value.split("T")
    const [year, month, day] = date.split("-").map(Number)
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return Number.isFinite(Date.parse(value))
      && month >= 1
      && month <= 12
      && day >= 1
      && day <= daysInMonth
      || "must be a valid ISO date-time"
  }),
)

export function createOutcomeId(input: {
  questionId: string
  surface: Schema.Schema.Type<typeof SurfaceSchema>
  answeredAt: string
}): string {
  return `outcome:${encodeURIComponent(input.questionId)}:${input.surface}:${encodeURIComponent(input.answeredAt)}`
}

export function createGradeId(outcomeId: string): string {
  return `grade:${encodeURIComponent(outcomeId)}`
}

export function createAskId(input: {
  unitId: string
  surface: Schema.Schema.Type<typeof SurfaceSchema>
  askedAt: string
}): string {
  return `ask:${encodeURIComponent(input.unitId)}:${input.surface}:${encodeURIComponent(input.askedAt)}`
}

export function createAnswerId(askId: string): string {
  return `answer:${encodeURIComponent(askId)}`
}

const askText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2000),
  Schema.makeFilter((value) => value.trim().length > 0 || "must not be blank"),
)

const askFields = {
  courseId: SlugSchema,
  unitId: SlugSchema,
  location: LocationSchema,
  text: askText,
  surface: SurfaceSchema,
  askedAt: isoDateTime,
}

function askLocationIssues(ask: { unitId: string; location: Location }): Schema.FilterIssue[] {
  return ask.location.unitId === ask.unitId
    ? []
    : [{ path: ["location", "unitId"], issue: "must match unitId" }]
}

export const AskInputSchema = Schema.Struct({
  type: Schema.Literal("ask"),
  ...askFields,
}).check(Schema.makeFilter(askLocationIssues))

export const AskSchema = Schema.Struct({
  type: Schema.Literal("ask"),
  id: nonEmptyString,
  ...askFields,
}).check(Schema.makeFilter((ask) => {
  const issues = askLocationIssues(ask)
  const expected = createAskId(ask)
  if (ask.id !== expected) issues.push({ path: ["id"], issue: `must equal deterministic id "${expected}"` })
  return issues
}))

const answerFields = {
  askId: nonEmptyString,
  text: nonEmptyString.check(Schema.makeFilter((value) => value.trim().length > 0 || "must not be blank")),
  nodeIds: Schema.Array(SlugSchema),
}

export const AnswerInputSchema = Schema.Struct({
  type: Schema.Literal("answer"),
  ...answerFields,
})

export const AnswerSchema = Schema.Struct({
  type: Schema.Literal("answer"),
  id: nonEmptyString,
  ...answerFields,
  answeredAt: isoDateTime,
}).check(Schema.makeFilter((answer) => {
  const expected = createAnswerId(answer.askId)
  return answer.id === expected || {
    path: ["id"],
    issue: `must equal deterministic id "${expected}"`,
  }
}))

export const AskRecordSchema = Schema.Union([AskSchema, AnswerSchema])

const outcomeFields = {
  courseId: SlugSchema,
  unitId: Schema.optional(SlugSchema),
  questionId: SlugSchema,
  nodeId: SlugSchema,
  tier: Schema.optional(Schema.Literals(["recall", "application"])),
  surface: SurfaceSchema,
  status: OutcomeStatusSchema,
  chosenIndex: Schema.optional(nonNegativeInteger),
  text: Schema.optional(nonEmptyString),
  learnerNote: Schema.optional(nonEmptyString),
  placementKey: Schema.optional(nonEmptyString),
}

function outcomeAnswerIssues(outcome: { chosenIndex?: number; text?: string }): Schema.FilterIssue[] {
  return outcome.chosenIndex !== undefined && outcome.text !== undefined
    ? [{ path: ["text"], issue: "cannot be combined with chosenIndex" }]
    : []
}

export const OutcomeInputSchema = Schema.Struct({
  type: Schema.Literal("outcome"),
  ...outcomeFields,
  answeredAt: isoDateTime,
}).check(Schema.makeFilter(outcomeAnswerIssues))

export const AgentOutcomeInputSchema = Schema.Struct({
  type: Schema.Literal("outcome"),
  ...outcomeFields,
  answeredAt: Schema.optional(isoDateTime),
}).check(Schema.makeFilter(outcomeAnswerIssues))

export const OutcomeSchema = Schema.Struct({
  type: Schema.Literal("outcome"),
  id: nonEmptyString,
  ...outcomeFields,
  answeredAt: isoDateTime,
}).check(
  Schema.makeFilter((outcome) => {
    const issues = outcomeAnswerIssues(outcome)
    const expected = createOutcomeId(outcome)
    if (outcome.id !== expected) {
      issues.push({ path: ["id"], issue: `must equal deterministic id "${expected}"` })
    }
    return issues
  }),
)

const gradeFields = {
  outcomeId: nonEmptyString,
  nodeId: SlugSchema,
  judgment: NodeJudgmentSchema,
  missing: oneSentence,
}

export const GradeOutcomeInputSchema = Schema.Struct({
  type: Schema.Literal("grade"),
  ...gradeFields,
})

export const GradeOutcomeSchema = Schema.Struct({
  type: Schema.Literal("grade"),
  id: nonEmptyString,
  ...gradeFields,
  gradedAt: Schema.optional(isoDateTime),
}).check(
  Schema.makeFilter((grade) => {
    const expected = createGradeId(grade.outcomeId)
    return grade.id === expected || {
      path: ["id"],
      issue: `must equal deterministic id "${expected}"`,
    }
  }),
)

export const OutcomeRecordSchema = Schema.Union([OutcomeSchema, GradeOutcomeSchema])

export type SourceMaterial = Schema.Schema.Type<typeof SourceMaterialSchema>
export type Location = Schema.Schema.Type<typeof LocationSchema>
export type Unit = Schema.Schema.Type<typeof UnitSchema>
export type Roadmap = Schema.Schema.Type<typeof RoadmapSchema>
export type Node = Schema.Schema.Type<typeof NodeSchema>
export type Nodes = Schema.Schema.Type<typeof NodesSchema>
export type ChoiceQuestion = Schema.Schema.Type<typeof ChoiceQuestionSchema>
export type ExplainBackQuestion = Schema.Schema.Type<typeof ExplainBackQuestionSchema>
export type Question = Schema.Schema.Type<typeof QuestionSchema>
export type Placement = Schema.Schema.Type<typeof PlacementSchema>
export type QuizPlan = Schema.Schema.Type<typeof QuizPlanSchema>
export type AskInput = Schema.Schema.Type<typeof AskInputSchema>
export type Ask = Schema.Schema.Type<typeof AskSchema>
export type AnswerInput = Schema.Schema.Type<typeof AnswerInputSchema>
export type Answer = Schema.Schema.Type<typeof AnswerSchema>
export type AskRecord = Schema.Schema.Type<typeof AskRecordSchema>
export type OutcomeInput = Schema.Schema.Type<typeof OutcomeInputSchema>
export type AgentOutcomeInput = Schema.Schema.Type<typeof AgentOutcomeInputSchema>
export type Outcome = Schema.Schema.Type<typeof OutcomeSchema>
export type GradeOutcomeInput = Schema.Schema.Type<typeof GradeOutcomeInputSchema>
export type GradeOutcome = Schema.Schema.Type<typeof GradeOutcomeSchema>
export type OutcomeRecord = Schema.Schema.Type<typeof OutcomeRecordSchema>
export type ClientLogLine = Schema.Schema.Type<typeof ClientLogLineSchema>
export type ClientLogs = Schema.Schema.Type<typeof ClientLogsSchema>
export type PlainParseResult<T> = { ok: true; value: T } | { ok: false; error: string }
export type LogLevel = "info" | "warn" | "error"
export type LogFields = {
  target?: string
  status?: string
  error?: string
  job_id?: string
  [key: string]: unknown
}

export type ReviewState = {
  nodeId: string
  box: 1 | 2 | 3 | 4
  dueAt: string
  lastReviewedAt: string
}
export type DailyStreak = { currentStreak: number; todayCounts: boolean }

export function placementKey(placement: Placement): string {
  if (placement.kind === "recap") return "recap"
  if (placement.kind === "pre-question" && !placement.location) {
    return `pre-question:${placement.questionId}`
  }
  const location = placement.location!.anchor
  return location.kind === "video-timestamp"
    ? `${placement.kind}:${location.seconds}`
    : `${placement.kind}:page:${location.page}`
}

export function placementQuestions(placement: Placement, questionPool: readonly Question[]): ChoiceQuestion[] {
  const authoredIds = placement.kind === "pre-question" ? [placement.questionId] : placement.questionIds
  return authoredIds.flatMap((id) => {
    const question = questionPool.find((candidate) => candidate.id === id)
    return question?.kind === "choice" ? [question] : []
  })
}

const reviewIntervals = [1, 3, 7, 21] as const

type ReviewHistory = {
  states: ReviewState[]
  creditedAt: string[]
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString()
}

function processReviewHistory(records: readonly OutcomeRecord[], now: string): ReviewHistory {
  const cutoff = Date.parse(now)
  const grades = new Map(records
    .filter((record): record is GradeOutcome => record.type === "grade"
      && (record.gradedAt === undefined || Date.parse(record.gradedAt) <= cutoff))
    .map((grade) => [grade.outcomeId, grade.judgment]))
  const evidence = records
    .filter((record): record is Outcome => record.type === "outcome"
      && record.tier === "application"
      && Date.parse(record.answeredAt) <= cutoff)
    .flatMap((record) => {
      if (record.status === "correct" || record.status === "wrong") {
        return [{
          key: `${record.courseId}:${record.nodeId}`,
          nodeId: record.nodeId,
          status: record.status,
          at: record.answeredAt,
          id: record.id,
        }]
      }
      if (record.status !== "ungraded") return []
      const judgment = grades.get(record.id)
      return judgment
        ? [{
            key: `${record.courseId}:${record.nodeId}`,
            nodeId: record.nodeId,
            status: judgment === "understood" ? "correct" as const : "wrong" as const,
            at: record.answeredAt,
            id: record.id,
          }]
        : []
    })
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id))
  const states = new Map<string, ReviewState>()
  const creditedAt: string[] = []

  for (const event of evidence) {
    const current = states.get(event.key)
    if (!current) {
      if (event.status === "correct") {
        states.set(event.key, {
          nodeId: event.nodeId,
          box: 1,
          dueAt: addDays(event.at, reviewIntervals[0]),
          lastReviewedAt: event.at,
        })
        creditedAt.push(event.at)
      }
      continue
    }
    if (event.status === "wrong") {
      states.set(event.key, {
        nodeId: event.nodeId,
        box: 1,
        dueAt: addDays(event.at, reviewIntervals[0]),
        lastReviewedAt: event.at,
      })
      continue
    }
    if (Date.parse(event.at) < Date.parse(current.dueAt)) continue
    const box = Math.min(4, current.box + 1) as ReviewState["box"]
    states.set(event.key, {
      nodeId: event.nodeId,
      box,
      dueAt: addDays(event.at, reviewIntervals[box - 1]),
      lastReviewedAt: event.at,
    })
    creditedAt.push(event.at)
  }

  return { states: [...states.values()], creditedAt }
}

export function deriveReviewStates(
  records: readonly OutcomeRecord[],
  now: string,
): ReviewState[] {
  return processReviewHistory(records, now).states
}

export function selectReviewQuestion(input: {
  nodeId: string
  questionPool: readonly Question[]
  outcomes: readonly Outcome[]
}): { question?: ChoiceQuestion; poolExhausted: boolean } {
  const eligible = input.questionPool.filter((question): question is ChoiceQuestion =>
    question.kind === "choice"
    && question.nodeId === input.nodeId
    && question.tier === "application")
  const latest = new Map<string, number>()
  for (const outcome of input.outcomes) {
    if (outcome.status === "skipped") continue
    latest.set(outcome.questionId, Math.max(
      latest.get(outcome.questionId) ?? Number.NEGATIVE_INFINITY,
      Date.parse(outcome.answeredAt),
    ))
  }
  const unanswered = eligible.find((question) => !latest.has(question.id))
  if (unanswered) return { question: unanswered, poolExhausted: false }
  const question = [...eligible].sort((left, right) =>
    (latest.get(left.id) ?? 0) - (latest.get(right.id) ?? 0))[0]
  return question ? { question, poolExhausted: true } : { poolExhausted: true }
}

function localDay(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number)
  const previous = new Date(Date.UTC(year, month - 1, date - 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`
}

export function deriveDailyStreak(
  records: readonly OutcomeRecord[],
  now: string,
  timeZone: string,
): DailyStreak {
  const days = new Set(processReviewHistory(records, now).creditedAt.map((at) => localDay(at, timeZone)))
  const today = localDay(now, timeZone)
  const todayCounts = days.has(today)
  let day = todayCounts ? today : previousDay(today)
  let currentStreak = 0
  while (days.has(day)) {
    currentStreak += 1
    day = previousDay(day)
  }
  return { currentStreak, todayCounts }
}

export function formatLog(level: LogLevel, stage: string, fields: LogFields = {}): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, stage, ...fields })
}

export function log(level: LogLevel, stage: string, fields: LogFields = {}): void {
  console.log(formatLog(level, stage, fields))
}

const decodeOptions = { errors: "all", onExcessProperty: "error" } as const

function decode<S extends Schema.Codec<any, any>>(
  schema: S,
  input: unknown,
  file: string,
): PlainParseResult<Schema.Schema.Type<S>> {
  const decoded = Schema.decodeUnknownResult(schema, decodeOptions)(input)
  if (decoded._tag === "Failure") {
    return { ok: false, error: `${file}: ${decoded.failure.message}` }
  }
  return { ok: true, value: decoded.success }
}

function parseJson<S extends Schema.Codec<any, any>>(
  text: string,
  file: string,
  schema: S,
): PlainParseResult<Schema.Schema.Type<S>> {
  log("info", "parse_state", { target: file, status: "start" })
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error) {
    const message = `${file}: root: invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    log("error", "parse_state", { target: file, status: "failed", error: message })
    return { ok: false, error: message }
  }
  const result = decode(schema, input, file)
  log(result.ok ? "info" : "error", "parse_state", {
    target: file,
    status: result.ok ? "ok" : "failed",
    ...(!result.ok && { error: result.error }),
  })
  return result
}

function serializeJson<S extends Schema.Codec<any, any>>(
  value: Schema.Schema.Type<S>,
  file: string,
  schema: S,
): string {
  const result = decode(schema, value, file)
  if (!result.ok) throw new Error(result.error)
  return `${JSON.stringify(result.value, null, 2)}\n`
}

export function parseRoadmap(text: string, file = "roadmap.json"): PlainParseResult<Roadmap> {
  return parseJson(text, file, RoadmapSchema)
}

export function serializeRoadmap(roadmap: Roadmap): string {
  return serializeJson(roadmap, "roadmap.json", RoadmapSchema)
}

export function parseNodes(text: string, file = "nodes.json"): PlainParseResult<Nodes> {
  return parseJson(text, file, NodesSchema)
}

export function serializeNodes(nodes: Nodes): string {
  return serializeJson(nodes, "nodes.json", NodesSchema)
}

export function parseQuizPlan(text: string, file = "quiz-plan.json"): PlainParseResult<QuizPlan> {
  return parseJson(text, file, QuizPlanSchema)
}

export function serializeQuizPlan(plan: QuizPlan): string {
  return serializeJson(plan, "quiz-plan.json", QuizPlanSchema)
}

export function parseOutcomes(text: string, file = "outcomes.jsonl"): PlainParseResult<OutcomeRecord[]> {
  log("info", "parse_outcomes", { target: file, status: "start" })
  const records: OutcomeRecord[] = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let input: unknown
    try {
      input = JSON.parse(line)
    } catch (error) {
      const message = `${file}:${index + 1}: root: invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      log("error", "parse_outcomes", { target: file, status: "failed", error: message })
      return { ok: false, error: message }
    }
    const decoded = decode(OutcomeRecordSchema, input, `${file}:${index + 1}`)
    if (!decoded.ok) {
      log("error", "parse_outcomes", { target: file, status: "failed", error: decoded.error })
      return decoded
    }
    records.push(decoded.value)
  }
  log("info", "parse_outcomes", { target: file, status: "ok" })
  return { ok: true, value: records }
}

export function serializeOutcome(outcome: OutcomeRecord): string {
  const result = decode(OutcomeRecordSchema, outcome, "outcomes.jsonl")
  if (!result.ok) throw new Error(result.error)
  return `${JSON.stringify(result.value)}\n`
}

export function parseAsks(text: string, file = "asks.jsonl"): PlainParseResult<AskRecord[]> {
  log("info", "parse_asks", { target: file, status: "start" })
  const records: AskRecord[] = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let input: unknown
    try {
      input = JSON.parse(line)
    } catch (error) {
      const message = `${file}:${index + 1}: root: invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      log("error", "parse_asks", { target: file, status: "failed", error: message })
      return { ok: false, error: message }
    }
    const decoded = decode(AskRecordSchema, input, `${file}:${index + 1}`)
    if (!decoded.ok) {
      log("error", "parse_asks", { target: file, status: "failed", error: decoded.error })
      return decoded
    }
    records.push(decoded.value)
  }
  log("info", "parse_asks", { target: file, status: "ok" })
  return { ok: true, value: records }
}

export function serializeAsk(record: AskRecord): string {
  const result = decode(AskRecordSchema, record, "asks.jsonl")
  if (!result.ok) throw new Error(result.error)
  return `${JSON.stringify(result.value)}\n`
}
