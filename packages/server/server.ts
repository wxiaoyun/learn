import {
  AskInputSchema,
  ClientLogsSchema,
  OutcomeInputSchema,
  SlugSchema,
  createAskId,
  createOutcomeId,
  deriveDailyStreak,
  deriveReviewStates,
  formatLog,
  parseAsks,
  parseNodes,
  parseOutcomes,
  parseQuizPlan,
  parseRoadmap,
  placementKey,
  serializeNodes,
  serializeQuizPlan,
  serializeRoadmap,
  selectReviewQuestion,
  type Answer,
  type Ask,
  type AskRecord,
  type ClientLogs,
  type GradeOutcome,
  type Nodes,
  type Outcome,
  type OutcomeRecord,
  type QuizPlan,
  type Roadmap,
} from "@learn/core"
import {
  appendAsk as appendAskFile,
  appendOutcome as appendOutcomeFile,
  asksPath,
  getLearningRoot,
  nodesPath,
  outcomesPath,
  quizPlanPath,
  roadmapPath,
} from "@learn/core/node"
import { BunHttpServer } from "@effect/platform-bun"
import { McpProtocol, McpServer } from "effect/unstable/ai"
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  Effect,
  Fiber,
  Layer,
  Schema,
  Semaphore,
} from "effect"
import { makeAgentTurns, type AgentDriver, type AgentTurns } from "./agent-turn"
import {
  ConflictError,
  LearningStore,
  NotFoundError,
  ServerLogger,
  StorageError,
  ValidationError,
  agentTools,
  invokeTool,
  mcpToolsLayer,
  type AppError,
  type LearningStoreService,
  type ServerLoggerService,
} from "./tools"

const decodeOptions = { errors: "all", onExcessProperty: "error" } as const
const OriginSchema = Schema.String.check(
  Schema.isPattern(/^chrome-extension:\/\/[^/,\s]+$/, {
    message: "must be chrome-extension://<id>",
  }),
)
const ServerConfigSchema = Schema.Struct({
  root: Schema.String.check(Schema.isMinLength(1)),
  port: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 65_535 })),
  allowedOrigins: Schema.Array(OriginSchema),
  agent: Schema.Literals(["claude", "pi", "off"]),
  agentTimeoutMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  recapDebounceMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
const VideoParamsSchema = Schema.Struct({ videoId: Schema.String.check(Schema.isMinLength(1)) })
const GradeParamsSchema = Schema.Struct({ outcomeId: Schema.String.check(Schema.isMinLength(1)) })
const AskParamsSchema = Schema.Struct({ askId: Schema.String.check(Schema.isMinLength(1)) })
const ToolParamsSchema = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)) })
const ReviewQuerySchema = Schema.Struct({ courseId: Schema.optional(SlugSchema) })
const OutcomesBodySchema = Schema.Union([
  OutcomeInputSchema,
  Schema.Array(OutcomeInputSchema).check(Schema.isMinLength(1)),
])

export type ServerConfig = Schema.Schema.Type<typeof ServerConfigSchema>

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const portText = env.LEARNING_PORT?.trim() || "4517"
  const port = Number(portText)
  const agent = (env.LEARNING_AGENT?.trim() || "claude") as AgentDriver
  const agentTimeoutMs = Number(env.LEARNING_AGENT_TIMEOUT_MS?.trim() || "300000")
  const recapDebounceMs = Number(env.LEARNING_RECAP_DEBOUNCE_MS?.trim() || "20000")
  // The browser extension's ID is fixed by the public key in its manifest, so
  // it is the default. Set the variable only to allow other origins.
  const allowedOrigins = (env.LEARNING_ALLOWED_ORIGINS?.trim() || "chrome-extension://ikiokbkockjjgcogfnggafjclojofmbj")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const decoded = Schema.decodeUnknownResult(ServerConfigSchema, decodeOptions)({
    root: getLearningRoot(env),
    port,
    allowedOrigins,
    agent,
    agentTimeoutMs,
    recapDebounceMs,
  })
  if (decoded._tag === "Failure") {
    throw new Error(decoded.failure.message)
  }
  return decoded.success
}

function loggerService(root: string): ServerLoggerService {
  const file = join(root, ".logs", "server.jsonl")
  const ready = mkdir(dirname(file), { recursive: true })
  return {
    write: (level, stage, fields = {}) => Effect.promise(async () => {
      const line = formatLog(level, stage, fields)
      try {
        await ready
        await appendFile(file, `${line}\n`, "utf8")
      } catch (error) {
        console.error(line)
        console.error(error)
      }
    }),
  }
}

function io<A>(
  stage: string,
  target: string,
  operation: () => Promise<A>,
): Effect.Effect<A, StorageError, ServerLogger> {
  return Effect.gen(function*() {
    const logger = yield* ServerLogger
    yield* logger.write("info", stage, { target, status: "start" })
    return yield* Effect.tryPromise({
      try: operation,
      catch: (error) => new StorageError({
        message: `${target}: ${error instanceof Error ? error.message : String(error)}`,
      }),
    }).pipe(
      Effect.tap(() => logger.write("info", stage, { target, status: "ok" })),
      Effect.tapError((error) => logger.write("error", stage, {
        target,
        status: "failed",
        error: error.message,
      })),
    )
  })
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function readOptional(file: string): Effect.Effect<string | undefined, StorageError, ServerLogger> {
  return Effect.gen(function*() {
    const logger = yield* ServerLogger
    yield* logger.write("info", "file_read", { target: file, status: "start" })
    return yield* Effect.promise(async () => {
      try {
        return { value: await readFile(file, "utf8") } as const
      } catch (error) {
        return { error } as const
      }
    }).pipe(
      Effect.flatMap((result) => {
        if ("value" in result) {
          return logger.write("info", "file_read", { target: file, status: "ok" }).pipe(
            Effect.as(result.value),
          )
        }
        if (isMissing(result.error)) {
          return logger.write("info", "file_read", { target: file, status: "missing" }).pipe(
            Effect.as(undefined),
          )
        }
        const error = new StorageError({
          message: `${file}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
        })
        return logger.write("error", "file_read", {
          target: file,
          status: "failed",
          error: error.message,
        }).pipe(Effect.andThen(Effect.fail(error)))
      }),
    )
  })
}

function requireFile(file: string): Effect.Effect<string, AppError, ServerLogger> {
  return readOptional(file).pipe(
    Effect.flatMap((text) => text === undefined
      ? Effect.fail(new NotFoundError({ message: `${file}: not found` }))
      : Effect.succeed(text)),
  )
}

function decodeFile<T>(
  stage: string,
  target: string,
  parse: () => { ok: true; value: T } | { ok: false; error: string },
): Effect.Effect<T, ValidationError, ServerLogger> {
  return Effect.gen(function*() {
    const logger = yield* ServerLogger
    yield* logger.write("info", stage, { target, status: "start" })
    const result = parse()
    yield* logger.write(result.ok ? "info" : "error", stage, {
      target,
      status: result.ok ? "ok" : "failed",
      ...(!result.ok && { error: result.error }),
    })
    return result.ok
      ? result.value
      : yield* new ValidationError({ message: result.error })
  })
}

function writeState(file: string, text: string): Effect.Effect<void, StorageError, ServerLogger> {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  return io("file_write", file, async () => {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temporary, text, "utf8")
    await rename(temporary, file)
  })
}

function courseIds(root: string): Effect.Effect<ReadonlyArray<string>, StorageError, ServerLogger> {
  return Effect.gen(function*() {
    const logger = yield* ServerLogger
    yield* logger.write("info", "course_scan", { target: root, status: "start" })
    const result = yield* Effect.promise(async () => {
      try {
        return { entries: await readdir(root, { withFileTypes: true }) } as const
      } catch (error) {
        return { error } as const
      }
    })
    if ("error" in result) {
      if (isMissing(result.error)) {
        yield* logger.write("info", "course_scan", { target: root, status: "empty" })
        return []
      }
      const error = new StorageError({
        message: `${root}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
      })
      yield* logger.write("error", "course_scan", {
        target: root,
        status: "failed",
        error: error.message,
      })
      return yield* error
    }
    yield* logger.write("info", "course_scan", { target: root, status: "ok" })
    return result.entries
      .filter((entry) => entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
  })
}

function roadmaps(root: string): Effect.Effect<ReadonlyArray<Roadmap>, AppError, ServerLogger> {
  return Effect.gen(function*() {
    const values: Roadmap[] = []
    for (const courseId of yield* courseIds(root)) {
      const file = roadmapPath(root, courseId)
      const text = yield* readOptional(file)
      if (text === undefined) continue
      values.push(yield* decodeFile("decode_roadmap", file, () => parseRoadmap(text, file)))
    }
    return values
  })
}

function makeStore(root: string, turns: AgentTurns): LearningStoreService {
  // ponytail: one global append queue fits one learner. Use per-course queues if outcome throughput grows.
  let appendQueue = Promise.resolve()
  const roadmapMutex = Semaphore.makeUnsafe(1)
  const quizPlanMutex = Semaphore.makeUnsafe(1)
  const queuedAppend = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = appendQueue.then(operation)
    appendQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  const getOutcomes = (courseId: string) => Effect.gen(function*() {
    const file = outcomesPath(root, courseId)
    const text = (yield* readOptional(file)) ?? ""
    return yield* decodeFile("decode_outcomes", file, () => parseOutcomes(text, file))
  })

  const getAsks = (courseId: string) => Effect.gen(function*() {
    const file = asksPath(root, courseId)
    const text = (yield* readOptional(file)) ?? ""
    return yield* decodeFile("decode_asks", file, () => parseAsks(text, file))
  })

  const getNodes = (courseId: string) => Effect.gen(function*() {
    const file = nodesPath(root, courseId)
    const text = yield* readOptional(file)
    return text === undefined
      ? []
      : yield* decodeFile("decode_nodes", file, () => parseNodes(text, file))
  })

  const getPlans = (roadmap: Roadmap) => Effect.gen(function*() {
    const plans: Array<{ unitId: string; plan: QuizPlan }> = []
    for (const unit of [...roadmap.units].sort((left, right) => left.order - right.order)) {
      const file = quizPlanPath(root, roadmap.courseId, unit.id)
      const text = yield* readOptional(file)
      if (text === undefined) continue
      plans.push({
        unitId: unit.id,
        plan: yield* decodeFile("decode_quiz_plan", file, () => parseQuizPlan(text, file)),
      })
    }
    return plans
  })

  const withResolvedTiers = (
    records: ReadonlyArray<OutcomeRecord>,
    plans: ReadonlyArray<{ unitId: string; plan: QuizPlan }>,
  ): OutcomeRecord[] => {
    const tiers = new Map(plans.flatMap(({ unitId, plan }) => plan.questionPool
      .map((question) => [`${unitId}:${question.id}`, question.tier] as const)))
    return records.map((record) => record.type === "outcome" && !record.tier && record.unitId
      ? { ...record, tier: tiers.get(`${record.unitId}:${record.questionId}`) }
      : record)
  }

  const appendAskRecord = (courseId: string, record: AskRecord) => Effect.gen(function*() {
    const file = asksPath(root, courseId)
    const logger = yield* ServerLogger
    yield* logger.write("info", "file_write", { target: file, status: "start" })
    return yield* Effect.tryPromise({
      try: () => queuedAppend(() => appendAskFile(file, record)),
      catch: (error) => new StorageError({
        message: `${file}: ${error instanceof Error ? error.message : String(error)}`,
      }),
    }).pipe(
      Effect.tap((status) => logger.write("info", "file_write", { target: file, status })),
      Effect.tapError((error) => logger.write("error", "file_write", {
        target: file,
        status: "failed",
        error: error.message,
      })),
      Effect.map((status) => ({ status, id: record.id })),
    )
  })

  const append = (courseId: string, record: OutcomeRecord) => Effect.gen(function*() {
    const file = outcomesPath(root, courseId)
    const logger = yield* ServerLogger
    yield* logger.write("info", "file_write", { target: file, status: "start" })
    return yield* Effect.tryPromise({
      try: () => queuedAppend(() => appendOutcomeFile(file, record)),
      catch: (error) => new StorageError({
        message: `${file}: ${error instanceof Error ? error.message : String(error)}`,
      }),
    }).pipe(
      Effect.tap((status) => logger.write("info", "file_write", { target: file, status })),
      Effect.tapError((error) => logger.write("error", "file_write", {
        target: file,
        status: "failed",
        error: error.message,
      })),
      Effect.map((status) => ({ status, id: record.id })),
    )
  })

  return {
    listCourses: Effect.gen(function*() {
      return (yield* roadmaps(root)).map((roadmap) => ({
        courseId: roadmap.courseId,
        title: roadmap.title,
      }))
    }),
    getCourseState: (courseId) => Effect.gen(function*() {
      const roadmapFile = roadmapPath(root, courseId)
      const roadmapText = yield* requireFile(roadmapFile)
      const roadmap = yield* decodeFile("decode_roadmap", roadmapFile, () => parseRoadmap(roadmapText, roadmapFile))
      const nodes = yield* getNodes(courseId)
      const plans = yield* getPlans(roadmap)
      const outcomes = withResolvedTiers(yield* getOutcomes(courseId), plans)
      const asks = yield* getAsks(courseId)
      const askValues = asks.filter((record): record is Ask => record.type === "ask")
      const askById = new Map(askValues.map((ask) => [ask.id, ask]))
      const answers = asks.filter((record): record is Answer => record.type === "answer")
      const outcomeValues = outcomes.filter((record): record is Outcome => record.type === "outcome")
      const reviews = new Map(deriveReviewStates(outcomes, new Date().toISOString())
        .map((review) => [review.nodeId, review]))
      const latest = (values: ReadonlyArray<Outcome>): string | undefined => values
        .reduce<Outcome | undefined>((current, outcome) =>
          !current || Date.parse(outcome.answeredAt) > Date.parse(current.answeredAt) ? outcome : current, undefined)
        ?.answeredAt
      const nodeSummaries = nodes.map((node) => {
        const values = outcomeValues.filter((outcome) => outcome.nodeId === node.id)
        const counts = {
          recall: { correct: 0, wrong: 0 },
          application: { correct: 0, wrong: 0 },
        }
        for (const outcome of values) {
          if (outcome.status !== "correct" && outcome.status !== "wrong") continue
          if (outcome.tier) counts[outcome.tier][outcome.status] += 1
        }
        const review = reviews.get(node.id)
        const nodeAsks = answers
          .filter((answer) => answer.nodeIds.includes(node.id))
          .flatMap((answer) => {
            const ask = askById.get(answer.askId)
            return ask ? [ask] : []
          })
        return {
          nodeId: node.id,
          counts,
          askCount: nodeAsks.length,
          latestAskAt: nodeAsks.map((ask) => ask.askedAt).sort().at(-1) ?? null,
          latestOutcomeAt: latest(values),
          latestCorrectApplicationAt: latest(values.filter((outcome) =>
            outcome.status === "correct" && outcome.tier === "application")),
          latestWrongAt: latest(values.filter((outcome) => outcome.status === "wrong")),
          box: review?.box ?? null,
          dueAt: review?.dueAt ?? null,
        }
      })
      return {
        roadmap,
        nodes,
        nodeSummaries,
        ungradedExplainBacks: outcomeValues.filter((outcome) =>
          outcome.status === "ungraded"
          && !outcomes.some((record) => record.type === "grade" && record.outcomeId === outcome.id)),
        flaggedQuestions: outcomeValues.filter((outcome) => outcome.status === "flagged"),
        recentAsks: askValues
          .flatMap((ask) => {
            const answer = answers.find((candidate) => candidate.askId === ask.id)
            return answer ? [{ ask, answer }] : []
          })
          .sort((left, right) => Date.parse(left.ask.askedAt) - Date.parse(right.ask.askedAt))
          .slice(-20),
        unansweredAsks: askValues.filter((ask) => !answers.some((answer) => answer.askId === ask.id)),
      }
    }),
    getDueReviews: (courseId) => Effect.gen(function*() {
      const available = yield* roadmaps(root)
      const selected = courseId
        ? available.filter((roadmap) => roadmap.courseId === courseId)
        : available
      if (courseId && selected.length === 0) {
        return yield* new NotFoundError({ message: `course "${courseId}" not found` })
      }
      const now = new Date().toISOString()
      const allRecords: OutcomeRecord[] = []
      const reviews: Array<Record<string, unknown>> = []
      for (const roadmap of selected) {
        const nodes = yield* getNodes(roadmap.courseId)
        const plans = yield* getPlans(roadmap)
        const records = withResolvedTiers(yield* getOutcomes(roadmap.courseId), plans)
        const outcomeValues = records.filter((record): record is Outcome => record.type === "outcome")
        const questionPool = plans.flatMap(({ plan }) => plan.questionPool)
        allRecords.push(...records)
        for (const state of deriveReviewStates(records, now)) {
          if (Date.parse(state.dueAt) > Date.parse(now)) continue
          const node = nodes.find((candidate) => candidate.id === state.nodeId)
          if (!node) continue
          const picked = selectReviewQuestion({
            nodeId: state.nodeId,
            questionPool,
            outcomes: outcomeValues,
          })
          const source = picked.question
            ? plans.find(({ plan }) => plan.questionPool.some((question) => question.id === picked.question?.id))
            : plans.find(({ plan }) => plan.nodeIds.includes(state.nodeId))
          reviews.push({
            courseId: roadmap.courseId,
            node,
            ...state,
            unitId: source?.unitId ?? null,
            question: picked.question ?? null,
            poolExhausted: picked.poolExhausted,
          })
        }
      }
      reviews.sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt))
        || String(left.courseId).localeCompare(String(right.courseId))
        || String((left.node as Nodes[number]).id).localeCompare(String((right.node as Nodes[number]).id)))
      return {
        reviews,
        streak: deriveDailyStreak(
          allRecords,
          now,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      }
    }),
    putRoadmap: (roadmap) => roadmapMutex.withPermits(1)(Effect.gen(function*() {
      for (const existing of yield* roadmaps(root)) {
        if (existing.courseId === roadmap.courseId) continue
        const existingIds = new Set(existing.units
          .filter((unit) => unit.kind === "youtube-video")
          .map((unit) => unit.source.videoId))
        const duplicate = roadmap.units.find((unit) =>
          unit.kind === "youtube-video" && existingIds.has(unit.source.videoId))
        if (duplicate?.kind === "youtube-video") {
          return yield* new ConflictError({
            message: `YouTube video ID "${duplicate.source.videoId}" already belongs to course "${existing.courseId}"`,
          })
        }
      }
      const file = roadmapPath(root, roadmap.courseId)
      yield* writeState(file, serializeRoadmap(roadmap))
      return { status: "replaced", courseId: roadmap.courseId }
    })),
    putNodes: (courseId, nodes: Nodes) => Effect.gen(function*() {
      const file = nodesPath(root, courseId)
      yield* writeState(file, serializeNodes(nodes))
      return { status: "replaced", courseId }
    }),
    putQuizPlan: (courseId, unitId, plan: QuizPlan) => quizPlanMutex.withPermits(1)(Effect.gen(function*() {
      if (plan.courseId !== courseId || plan.unitId !== unitId) {
        return yield* new ValidationError({
          message: "put_quiz_plan: courseId and unitId must match the quiz plan",
        })
      }
      const roadmapFile = roadmapPath(root, courseId)
      const roadmapText = yield* readOptional(roadmapFile)
      if (roadmapText !== undefined) {
        const roadmap = yield* decodeFile("decode_roadmap", roadmapFile, () => parseRoadmap(roadmapText, roadmapFile))
        for (const existing of yield* getPlans(roadmap)) {
          if (existing.unitId === unitId) continue
          const ids = new Set(existing.plan.questionPool.map((question) => question.id))
          const duplicate = plan.questionPool.find((question) => ids.has(question.id))
          if (duplicate) {
            return yield* new ValidationError({
              message: `put_quiz_plan: question id "${duplicate.id}" already belongs to unit "${existing.unitId}"`,
            })
          }
        }
      }
      const file = quizPlanPath(root, courseId, unitId)
      yield* writeState(file, serializeQuizPlan(plan))
      return { status: "replaced", courseId, unitId }
    })),
    getOutcomes: (courseId, since) => Effect.gen(function*() {
      const records = yield* getOutcomes(courseId)
      if (!since) return records
      const sinceTime = Date.parse(since)
      return records.filter((record) => record.type === "outcome"
        ? Date.parse(record.answeredAt) >= sinceTime
        : record.gradedAt === undefined || Date.parse(record.gradedAt) >= sinceTime)
    }),
    appendOutcome: (outcome) => append(outcome.courseId, outcome),
    appendAsk: (ask) => Effect.gen(function*() {
      const file = roadmapPath(root, ask.courseId)
      const text = yield* requireFile(file)
      const courseRoadmap = yield* decodeFile("decode_roadmap", file, () => parseRoadmap(text, file))
      const unit = courseRoadmap.units.find((candidate) => candidate.id === ask.unitId)
      if (!unit || unit.kind !== "youtube-video") {
        return yield* new ValidationError({
          message: `Ask unit "${ask.unitId}" is not a Roadmap video Unit of Course "${ask.courseId}"`,
        })
      }
      if (ask.location.anchor.kind !== "video-timestamp") {
        return yield* new ValidationError({ message: "Ask location must be a video timestamp" })
      }
      return yield* appendAskRecord(ask.courseId, ask)
    }),
    appendAnswer: (courseId, answer) => Effect.gen(function*() {
      const askHistory = yield* getAsks(courseId)
      const ask = askHistory.find((record): record is Ask => record.type === "ask" && record.id === answer.askId)
      if (!ask) {
        return yield* new NotFoundError({ message: `no Ask "${answer.askId}" exists in Course "${courseId}"` })
      }
      const existing = askHistory.find((record): record is Answer => record.type === "answer" && record.askId === answer.askId)
      if (existing) return { status: "duplicate", id: existing.id }
      const nodes = yield* getNodes(courseId)
      const nodeIds = new Set(nodes.map((node) => node.id))
      const unknown = answer.nodeIds.find((nodeId) => !nodeIds.has(nodeId))
      if (unknown) {
        return yield* new ValidationError({
          message: `answer_ask: Node id "${unknown}" does not exist in Course "${courseId}"`,
        })
      }
      return yield* appendAskRecord(courseId, answer)
    }),
    getAsk: (askId) => Effect.gen(function*() {
      for (const courseId of yield* courseIds(root)) {
        const history = yield* getAsks(courseId)
        const ask = history.find((record): record is Ask => record.type === "ask" && record.id === askId)
        if (!ask) continue
        const answer = history.find((record): record is Answer => record.type === "answer" && record.askId === askId)
        return { ask, answer: answer ?? null, failed: !answer && turns.askFailed(askId) }
      }
      return yield* new NotFoundError({ message: `no Ask exists with id "${askId}"` })
    }),
    asksByVideo: (videoId) => Effect.gen(function*() {
      for (const courseRoadmap of yield* roadmaps(root)) {
        const unit = courseRoadmap.units.find((candidate) =>
          candidate.kind === "youtube-video" && candidate.source.videoId === videoId)
        if (!unit) continue
        const history = yield* getAsks(courseRoadmap.courseId)
        const answers = history.filter((record): record is Answer => record.type === "answer")
        const asks = history
          .filter((record): record is Ask => record.type === "ask" && record.unitId === unit.id)
          .sort((left, right) => Date.parse(left.askedAt) - Date.parse(right.askedAt))
          .map((ask) => ({
            ask,
            answer: answers.find((answer) => answer.askId === ask.id) ?? null,
            failed: !answers.some((answer) => answer.askId === ask.id) && turns.askFailed(ask.id),
          }))
        return { courseId: courseRoadmap.courseId, unitId: unit.id, asks }
      }
      return yield* new NotFoundError({ message: `no Course video exists for video ID "${videoId}"` })
    }),
    appendGrade: (courseId, grade: GradeOutcome) => append(courseId, grade),
    getGrade: (outcomeId) => Effect.gen(function*() {
      for (const courseId of yield* courseIds(root)) {
        const grade = (yield* getOutcomes(courseId)).find((record): record is GradeOutcome =>
          record.type === "grade" && record.outcomeId === outcomeId)
        if (grade) return grade
      }
      return yield* new NotFoundError({ message: `no Grade exists for Outcome "${outcomeId}"` })
    }),
    quizPlanByVideo: (videoId) => Effect.gen(function*() {
      // ponytail: linear course scan is fine for a personal library. Index by video ID if course count makes lookup slow.
      for (const roadmap of yield* roadmaps(root)) {
        const unit = roadmap.units.find((candidate) =>
          candidate.kind === "youtube-video" && candidate.source.videoId === videoId)
        if (!unit) continue
        const file = quizPlanPath(root, roadmap.courseId, unit.id)
        const text = yield* readOptional(file)
        if (text === undefined) {
          const hint = yield* Effect.tryPromise({
            try: () => turns.missingPlanHint(roadmap, unit),
            catch: (error) => new StorageError({
              message: `derive Quiz plan hint: ${error instanceof Error ? error.message : String(error)}`,
            }),
          })
          return yield* new NotFoundError({
            message: `no Quiz plan exists for Course video ID "${videoId}"`,
            details: { courseVideo: true, hint },
          })
        }
        const plan = yield* decodeFile("decode_quiz_plan", file, () => parseQuizPlan(text, file))
        const outcomes = yield* getOutcomes(roadmap.courseId)
        const unitOutcomes = outcomes.filter((record): record is Outcome =>
          record.type === "outcome" && record.unitId === unit.id)
        const answeredPlacementKeys = plan.placements.flatMap((placement) => {
          if (placement.kind === "recap") return []
          const key = placementKey(placement)
          const authoredIds = placement.kind === "pre-question"
            ? [placement.questionId]
            : placement.questionIds
          const answered = new Set(unitOutcomes
            .filter((outcome) => outcome.status !== "skipped"
              && (outcome.placementKey === key
                || (outcome.placementKey === undefined && authoredIds.includes(outcome.questionId))))
            .map((outcome) => outcome.questionId))
          return answered.size >= authoredIds.length ? [key] : []
        })
        const answeredQuestionIds = [...new Set(unitOutcomes
          .filter((outcome) => outcome.status !== "skipped")
          .map((outcome) => outcome.questionId))]
        const correctQuestionIds = [...new Set(unitOutcomes
          .filter((outcome) => outcome.status === "correct")
          .map((outcome) => outcome.questionId))]
        const latestByQuestion = new Map<string, Outcome>()
        for (const outcome of unitOutcomes) {
          const current = latestByQuestion.get(outcome.questionId)
          if (!current || Date.parse(outcome.answeredAt) > Date.parse(current.answeredAt)) {
            latestByQuestion.set(outcome.questionId, outcome)
          }
        }
        const wrongQuestionIds = [...latestByQuestion.values()]
          .filter((outcome) => outcome.status === "wrong")
          .map((outcome) => outcome.questionId)
        return {
          courseId: roadmap.courseId,
          unitId: unit.id,
          plan,
          answeredQuestionIds,
          answeredPlacementKeys,
          correctQuestionIds,
          wrongQuestionIds,
        }
      }
      return yield* new NotFoundError({
        message: `no quiz plan exists for YouTube video ID "${videoId}"`,
      })
    }),
  }
}

function decodeHttp<A, I>(
  stage: string,
  target: string,
  schema: Schema.Codec<A, I>,
  input: unknown,
): Effect.Effect<A, ValidationError, ServerLogger> {
  return Effect.gen(function*() {
    const logger = yield* ServerLogger
    yield* logger.write("info", stage, { target, status: "start" })
    return yield* Schema.decodeUnknownEffect(schema, decodeOptions)(input).pipe(
      Effect.tap(() => logger.write("info", stage, { target, status: "ok" })),
      Effect.mapError((error) => new ValidationError({
        message: error.message,
      })),
      Effect.tapError((error) => logger.write("error", stage, {
        target,
        status: "failed",
        error: error.message,
      })),
    )
  })
}

function body<A, I>(
  stage: string,
  schema: Schema.Codec<A, I>,
): Effect.Effect<A, ValidationError, HttpServerRequest.HttpServerRequest | ServerLogger> {
  return Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const input = yield* request.json.pipe(
      Effect.mapError((error) => new ValidationError({ message: `invalid JSON body: ${String(error)}` })),
    )
    const pathname = new URL(request.url, "http://127.0.0.1").pathname
    return yield* decodeHttp(stage, pathname, schema, input)
  })
}

function statusOf(error: AppError): number {
  if (error._tag === "ValidationError") return 400
  if (error._tag === "NotFoundError") return 404
  if (error._tag === "ConflictError") return 409
  return 500
}

function handled<A extends HttpServerResponse.HttpServerResponse, R>(
  effect: Effect.Effect<A, AppError, R>,
): Effect.Effect<A | HttpServerResponse.HttpServerResponse, never, R | ServerLogger> {
  return effect.pipe(Effect.catch((error) => Effect.gen(function*() {
    const logger = yield* ServerLogger
    yield* logger.write("error", "http_request", {
      target: "request",
      status: "failed",
      error: error.message,
    })
    const details = error instanceof NotFoundError ? error.details : undefined
    return HttpServerResponse.jsonUnsafe({ error: error.message, ...details }, { status: statusOf(error) })
  })))
}

function routes(turns: AgentTurns) {
  return HttpRouter.use((router) => Effect.all([
    router.add("GET", "/health", Effect.succeed(HttpServerResponse.jsonUnsafe({ status: "ok" }))),
    router.add("GET", "/quiz-plans/by-video/:videoId", handled(Effect.gen(function*() {
      const params = yield* HttpRouter.params
      const { videoId } = yield* decodeHttp("decode_path", "/quiz-plans/by-video/:videoId", VideoParamsSchema, params)
      return HttpServerResponse.jsonUnsafe(yield* Effect.flatMap(LearningStore, (store) => store.quizPlanByVideo(videoId)))
    }))),
    router.add("GET", "/asks/by-video/:videoId", handled(Effect.gen(function*() {
      const params = yield* HttpRouter.params
      const { videoId } = yield* decodeHttp("decode_path", "/asks/by-video/:videoId", VideoParamsSchema, params)
      return HttpServerResponse.jsonUnsafe(yield* Effect.flatMap(LearningStore, (store) => store.asksByVideo(videoId)))
    }))),
    router.add("GET", "/asks/:askId", handled(Effect.gen(function*() {
      const params = yield* HttpRouter.params
      const { askId } = yield* decodeHttp("decode_path", "/asks/:askId", AskParamsSchema, params)
      return HttpServerResponse.jsonUnsafe(yield* Effect.flatMap(LearningStore, (store) => store.getAsk(askId)))
    }))),
    router.add("GET", "/grades/:outcomeId", handled(Effect.gen(function*() {
      const params = yield* HttpRouter.params
      const { outcomeId } = yield* decodeHttp("decode_path", "/grades/:outcomeId", GradeParamsSchema, params)
      return HttpServerResponse.jsonUnsafe(yield* Effect.flatMap(LearningStore, (store) => store.getGrade(outcomeId)))
    }))),
    router.add("GET", "/reviews/due", handled(Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const query = Object.fromEntries(new URL(request.url, "http://127.0.0.1").searchParams)
      const { courseId } = yield* decodeHttp("decode_query", "/reviews/due", ReviewQuerySchema, query)
      return HttpServerResponse.jsonUnsafe(yield* Effect.flatMap(LearningStore, (store) => store.getDueReviews(courseId)))
    }))),
    router.add("POST", "/asks", handled(Effect.gen(function*() {
      if (!turns.asksEnabled()) {
        return HttpServerResponse.jsonUnsafe({ error: "asks are disabled because the learning agent is off" }, { status: 503 })
      }
      const input = yield* body("decode_ask_body", AskInputSchema)
      const ask: Ask = { ...input, id: createAskId(input) }
      const store = yield* LearningStore
      const result = yield* store.appendAsk(ask)
      if ((result as { status?: string }).status === "appended") turns.handleAsk(ask)
      return HttpServerResponse.jsonUnsafe(result)
    }))),
    router.add("POST", "/outcomes", handled(Effect.gen(function*() {
      const decoded = yield* body("decode_outcomes_body", OutcomesBodySchema)
      const inputs = Array.isArray(decoded) ? decoded : [decoded]
      const store = yield* LearningStore
      const results = []
      for (const input of inputs) {
        const outcome: Outcome = {
          ...input,
          id: createOutcomeId(input),
        }
        const result = yield* store.appendOutcome(outcome)
        results.push(result)
        if ((result as { status?: string }).status === "appended") turns.handleOutcome(outcome)
      }
      return HttpServerResponse.jsonUnsafe({ results })
    }))),
    router.add("POST", "/logs", handled(Effect.gen(function*() {
      const decoded: ClientLogs = yield* body("decode_logs_body", ClientLogsSchema)
      const logger = yield* ServerLogger
      for (const line of decoded.lines) {
        yield* logger.write(line.level, line.stage, {
          ...line.fields,
          surface: decoded.surface,
          target: line.target,
          status: line.status,
          error: line.error,
        })
      }
      return HttpServerResponse.jsonUnsafe({ appended: decoded.lines.length })
    }))),
    router.add("POST", "/tools/:name", handled(Effect.gen(function*() {
      const params = yield* HttpRouter.params
      const { name } = yield* decodeHttp("decode_path", "/tools/:name", ToolParamsSchema, params)
      const request = yield* HttpServerRequest.HttpServerRequest
      const input = yield* request.json.pipe(
        Effect.mapError((error) => new ValidationError({ message: `invalid JSON body: ${String(error)}` })),
      )
      return HttpServerResponse.jsonUnsafe(yield* invokeTool(name, input))
    }))),
  ], { discard: true }))
}

function middleware(allowedOrigins: ReadonlyArray<string>) {
  const allowed = new Set(allowedOrigins)
  return (app: any) => Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const logger = yield* ServerLogger
    const pathname = new URL(request.url, "http://127.0.0.1").pathname
    const jobId = crypto.randomUUID()
    yield* logger.write("info", "http_request", {
      job_id: jobId,
      target: pathname,
      method: request.method,
      status: "start",
    })
    const origin = request.headers.origin
    if (origin && !allowed.has(origin)) {
      yield* logger.write("warn", "origin_check", {
        job_id: jobId,
        target: origin,
        status: "rejected",
        error: "origin not allowed",
      })
      return HttpServerResponse.jsonUnsafe({ error: "origin not allowed" }, { status: 403 })
    }
    if (request.method === "OPTIONS" && origin) {
      return HttpServerResponse.empty({
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          vary: "Origin",
        },
      })
    }
    return yield* app
  }).pipe(
    // Every route already maps its own failures, so what reaches here is a
    // transport failure the server answers for. Log it and let it through.
    Effect.tapError((error: unknown) => Effect.gen(function*() {
      const logger = yield* ServerLogger
      yield* logger.write("error", "http_request", {
        target: "request",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      })
    })),
  )
}

function appLayer(
  config: ServerConfig,
  turns: AgentTurns,
  logger: ServerLoggerService,
  onListening: (port: number) => void,
) {
  const LoggerLive = Layer.succeed(ServerLogger, logger)
  const StoreLive = Layer.succeed(LearningStore, makeStore(config.root, turns))
  // Built only after the request handler is registered, so the reported port
  // never points at a socket that still answers with the placeholder 404.
  const ListeningLive = Layer.effectDiscard(Effect.gen(function*() {
    const server = yield* HttpServer.HttpServer
    onListening(server.address._tag === "UnixPathAddress" ? config.port : server.address.port)
  }))
  const served = HttpRouter.serve(
    Layer.mergeAll(
      routes(turns),
      HttpRouter.cors({
        allowedOrigins: config.allowedOrigins,
        allowedMethods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["content-type"],
      }),
      Layer.provide(mcpToolsLayer, McpServer.layerHttp({
        name: "learning",
        version: "0.1.0",
        path: "/mcp",
        protocols: [
          McpProtocol.v2026_07_28,
          McpProtocol.v2025_11_25,
          McpProtocol.v2025_06_18,
          McpProtocol.v2025_03_26,
          McpProtocol.v2024_11_05,
        ],
      })),
    ),
    {
      disableLogger: true,
      disableListenLog: true,
      middleware: middleware(config.allowedOrigins),
    },
  )
  return Layer.provide(ListeningLive, served).pipe(
    Layer.provide(StoreLive),
    Layer.provide(LoggerLive),
    Layer.provide(BunHttpServer.layer({
      hostname: "127.0.0.1",
      port: config.port,
    })),
  )
}

export type RunningServer = {
  readonly port: number
  readonly close: () => Promise<void>
}

export async function startServer(
  input: ServerConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunningServer> {
  const decoded = Schema.decodeUnknownResult(ServerConfigSchema, decodeOptions)(input)
  if (decoded._tag === "Failure") throw new Error(decoded.failure.message)
  const config = decoded.success
  const logger = loggerService(config.root)
  let boundPort: number | undefined
  const turns = makeAgentTurns({
    root: config.root,
    driver: config.agent,
    timeoutMs: config.agentTimeoutMs,
    recapDebounceMs: config.recapDebounceMs,
    port: () => boundPort ?? config.port,
    env,
    logger,
  })
  const listening = Promise.withResolvers<number>()
  const program = Layer.launch(appLayer(config, turns, logger, (port) => {
    boundPort = port
    listening.resolve(port)
  })) as Effect.Effect<never, unknown, never>
  const fiber = Effect.runFork(program)
  const port = await Promise.race([listening.promise, Bun.sleep(5_000).then(() => undefined)])
  if (port === undefined) {
    await Effect.runPromise(Fiber.interrupt(fiber))
    throw new Error("learning server did not start within 5 seconds")
  }
  return {
    port,
    close: async () => {
      await turns.close()
      await Effect.runPromise(Fiber.interrupt(fiber))
    },
  }
}

export const toolNames = agentTools.map((tool) => tool.name)
