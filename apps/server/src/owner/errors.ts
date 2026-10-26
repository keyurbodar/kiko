import * as Schema from "effect/Schema"

export class ArchiveError extends Schema.TaggedError<ArchiveError>()("ArchiveError", {
  kind: Schema.Literals([
    "invalid_room",
    "invalid_day",
    "not_serializable",
    "cursor_stuck",
    "incomplete",
    "no_binding",
  ]),
  message: Schema.String,
}) {}

export class HistoryError extends Schema.TaggedError<HistoryError>()("HistoryError", {
  kind: Schema.Literals(["incomplete", "deleted"]),
  message: Schema.String,
}) {}

export class ScheduleError extends Schema.TaggedError<ScheduleError>()("ScheduleError", {
  kind: Schema.Literals(["deadline", "handoff"]),
  taskId: Schema.optionalKey(Schema.String),
  message: Schema.String,
}) {}

export class AgentKeyError extends Schema.TaggedError<AgentKeyError>()("AgentKeyError", {
  kind: Schema.Literals(["agent_key", "room", "deadline"]),
  key: Schema.String,
  message: Schema.String,
}) {}

export class EgressError extends Schema.TaggedError<EgressError>()("EgressError", {
  url: Schema.String,
  message: Schema.String,
}) {}
