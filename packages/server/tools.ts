import { McpServer } from "@effect/ai"
import { CallToolResult, Tool as McpTool } from "@effect/ai/McpSchema"
import {
  AgentOutcomeInputSchema,
  GradeOutcomeInputSchema,
  SlugSchema,
  createAnswerId,
  createGradeId,
  createOutcomeId,
  parseAsks,
  NodesSchema,
  QuizPlanSchema,
  RoadmapSchema,
  parseNodes,
  parseOutcomes,
  parseQuizPlan,
  parseRoadmap,
  type Answer,
  type Ask,
  type GradeOutcome,
  type Nodes,
  type Outcome,
  type OutcomeRecord,
  type QuizPlan,
  type Roadmap,
} from "@learn/core"
import { Context, Data, Effect, JSONSchema, Layer, ParseResult, Schema } from "effect"

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string
  readonly details?: Record<string, unknown>
}> {}

export class ConflictError extends Data.TaggedError("ConflictError")<{
  readonly message: string
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string
}> {}

export type AppError = ValidationError | NotFoundError | ConflictError | StorageError

export interface LearningStoreService {
  readonly listCourses: Effect.Effect<unknown, AppError, ServerLogger>
  readonly getCourseState: (courseId: string) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly getDueReviews: (courseId?: string) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly putRoadmap: (roadmap: Roadmap) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly putNodes: (courseId: string, nodes: Nodes) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly putQuizPlan: (
    courseId: string,
    unitId: string,
    plan: QuizPlan,
  ) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly getOutcomes: (
    courseId: string,
    since?: string,
  ) => Effect.Effect<ReadonlyArray<OutcomeRecord>, AppError, ServerLogger>
  readonly appendOutcome: (outcome: Outcome) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly appendAsk: (ask: Ask) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly appendAnswer: (courseId: string, answer: Answer) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly getAsk: (askId: string) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly asksByVideo: (videoId: string) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly appendGrade: (
    courseId: string,
    grade: GradeOutcome,
  ) => Effect.Effect<unknown, AppError, ServerLogger>
  readonly getGrade: (outcomeId: string) => Effect.Effect<GradeOutcome, AppError, ServerLogger>
  readonly quizPlanByVideo: (videoId: string) => Effect.Effect<unknown, AppError, ServerLogger>
}

export class LearningStore extends Context.Tag("@learn/server/LearningStore")<
  LearningStore,
  LearningStoreService
>() {}

export interface ServerLoggerService {
  readonly write: (
    level: "info" | "warn" | "error",
    stage: string,
    fields?: Record<string, unknown>,
  ) => Effect.Effect<void>
}

export class ServerLogger extends Context.Tag("@learn/server/ServerLogger")<
  ServerLogger,
  ServerLoggerService
>() {}

const isoDateTime = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, {
    message: () => "must be an ISO date-time",
  }),
)

function parsed<T>(result: { ok: true; value: T } | { ok: false; error: string }): Effect.Effect<T, ValidationError> {
  return result.ok ? Effect.succeed(result.value) : Effect.fail(new ValidationError({ message: result.error }))
}

type Fields = Schema.Struct.Fields

type AgentToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: Schema.Schema.AnyNoContext
  readonly jsonSchema: Record<string, unknown>
  readonly handler: (input: any) => Effect.Effect<unknown, AppError, LearningStore | ServerLogger>
}

function defineTool<const Name extends string>(
  name: Name,
  description: string,
  fields: Fields,
  handler: AgentToolDefinition["handler"],
): AgentToolDefinition {
  const inputSchema = Schema.Struct(fields) as unknown as Schema.Schema.AnyNoContext
  const emitted = JSONSchema.make(inputSchema) as unknown as Record<string, unknown>
  const jsonSchema = Object.keys(fields).length === 0
    ? { ...emitted, type: "object", properties: {}, additionalProperties: false, anyOf: undefined }
    : emitted
  const text = JSON.stringify(jsonSchema)
  if (text.includes('"$ref"') || text.includes('"$defs"')) {
    throw new Error(`${name}: tool JSON Schema must not contain $ref or $defs`)
  }
  return {
    name,
    description,
    inputSchema,
    jsonSchema,
    handler,
  }
}

export const agentTools: ReadonlyArray<AgentToolDefinition> = [
  defineTool("list_courses", "List course ids and titles.", {}, () =>
    Effect.flatMap(LearningStore, (store) => store.listCourses)),
  defineTool("get_course_state", "Get roadmap, nodes, Outcome and Ask summaries, ungraded explain-backs, and flagged Questions for one Course.", {
    courseId: SlugSchema,
  }, ({ courseId }) => Effect.flatMap(LearningStore, (store) => store.getCourseState(courseId))),
  defineTool("get_due_reviews", "Get due Nodes, picked review Questions, pool status, and daily streak across Courses.", {
    courseId: Schema.optional(SlugSchema),
  }, ({ courseId }) => Effect.flatMap(LearningStore, (store) => store.getDueReviews(courseId))),
  defineTool("put_roadmap", "Validate and fully replace one course roadmap.", {
    roadmap: RoadmapSchema,
  }, ({ roadmap }) => Effect.gen(function*() {
    const value = yield* parsed(parseRoadmap(JSON.stringify(roadmap), "put_roadmap"))
    return yield* Effect.flatMap(LearningStore, (store) => store.putRoadmap(value))
  })),
  defineTool("put_nodes", "Validate and fully replace one course node graph.", {
    courseId: SlugSchema,
    nodes: NodesSchema,
  }, ({ courseId, nodes }) => Effect.gen(function*() {
    const value = yield* parsed(parseNodes(JSON.stringify(nodes), "put_nodes"))
    return yield* Effect.flatMap(LearningStore, (store) => store.putNodes(courseId, value))
  })),
  defineTool("put_quiz_plan", "Validate and fully replace one unit quiz plan.", {
    courseId: SlugSchema,
    unitId: SlugSchema,
    plan: QuizPlanSchema,
  }, ({ courseId, unitId, plan }) => Effect.gen(function*() {
    const value = yield* parsed(parseQuizPlan(JSON.stringify(plan), "put_quiz_plan"))
    return yield* Effect.flatMap(LearningStore, (store) => store.putQuizPlan(courseId, unitId, value))
  })),
  defineTool("get_outcomes", "Get outcome records for one course, optionally since an ISO timestamp.", {
    courseId: SlugSchema,
    since: Schema.optional(isoDateTime),
  }, ({ courseId, since }) => Effect.flatMap(LearningStore, (store) => store.getOutcomes(courseId, since))),
  defineTool("append_outcome", "Append one outcome. The server supplies its deterministic id and defaults answeredAt to now.", {
    outcome: AgentOutcomeInputSchema,
  }, ({ outcome }) => Effect.gen(function*() {
    const answeredAt = outcome.answeredAt ?? new Date().toISOString()
    const record = {
      ...outcome,
      answeredAt,
      id: createOutcomeId({ questionId: outcome.questionId, surface: outcome.surface, answeredAt }),
    }
    const records = yield* parsed(parseOutcomes(`${JSON.stringify(record)}\n`, "append_outcome"))
    return yield* Effect.flatMap(LearningStore, (store) => store.appendOutcome(records[0] as Outcome))
  })),
  defineTool("answer_ask", "Append one Answer to an Ask. The server supplies ids and time.", {
    courseId: SlugSchema,
    askId: Schema.String.pipe(Schema.minLength(1)),
    text: Schema.String.pipe(Schema.minLength(1)),
    nodeIds: Schema.Array(SlugSchema),
  }, ({ courseId, askId, text, nodeIds }) => Effect.gen(function*() {
    const record = {
      type: "answer" as const,
      id: createAnswerId(askId),
      askId,
      text,
      nodeIds,
      answeredAt: new Date().toISOString(),
    }
    const records = yield* parsed(parseAsks(`${JSON.stringify(record)}\n`, "answer_ask"))
    return yield* Effect.flatMap(LearningStore, (store) => store.appendAnswer(courseId, records[0] as Answer))
  })),
  defineTool("append_grade", "Append one explain-back grade. The server supplies its deterministic id.", {
    courseId: SlugSchema,
    grade: GradeOutcomeInputSchema,
  }, ({ courseId, grade }) => Effect.gen(function*() {
    const record = {
      ...grade,
      id: createGradeId(grade.outcomeId),
      gradedAt: new Date().toISOString(),
    }
    const records = yield* parsed(parseOutcomes(`${JSON.stringify(record)}\n`, "append_grade"))
    return yield* Effect.flatMap(LearningStore, (store) => store.appendGrade(courseId, records[0] as GradeOutcome))
  })),
]

const byName = new Map(agentTools.map((tool) => [tool.name, tool]))

export function invokeTool(name: string, input: unknown): Effect.Effect<unknown, AppError, LearningStore | ServerLogger> {
  return Effect.gen(function*() {
    const logger = yield* ServerLogger
    const tool = byName.get(name)
    if (!tool) return yield* new NotFoundError({ message: `unknown learning tool "${name}"` })
    yield* logger.write("info", "tool_call", { target: name, status: "start" })
    const decoded = yield* Schema.decodeUnknown(tool.inputSchema, {
      errors: "all",
      onExcessProperty: "error",
    })(input).pipe(
      Effect.mapError((error) => new ValidationError({
        message: `${name}: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
      })),
    )
    return yield* tool.handler(decoded).pipe(
      Effect.tap(() => logger.write("info", "tool_call", { target: name, status: "ok" })),
      Effect.tapError((error) => logger.write("error", "tool_call", {
        target: name,
        status: "failed",
        error: error.message,
      })),
    )
  })
}

export const mcpToolsLayer = Layer.effectDiscard(Effect.gen(function*() {
  const server = yield* McpServer.McpServer
  const services = yield* Effect.context<LearningStore | ServerLogger>()
  for (const definition of agentTools) {
    yield* server.addTool({
      tool: new McpTool({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.jsonSchema,
      }),
      handle: (input) => invokeTool(definition.name, input).pipe(
        Effect.provide(services),
        Effect.match({
          onFailure: (error) => new CallToolResult({
            isError: true,
            structuredContent: { error: error.message },
            content: [{ type: "text", text: error.message }],
          }),
          onSuccess: (result) => new CallToolResult({
            isError: false,
            structuredContent: typeof result === "object" ? result : undefined,
            content: [{ type: "text", text: JSON.stringify(result) }],
          }),
        }),
      ) as any,
    })
  }
})).pipe(Layer.provide(McpServer.McpServer.layer))
