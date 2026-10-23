import * as Schema from "effect/Schema"

export class AgentGone extends Schema.TaggedError<AgentGone>()("AgentGone", {
  message: Schema.String,
}) {}

export class AgentHomeMissing extends Schema.TaggedError<AgentHomeMissing>()("AgentHomeMissing", {
  message: Schema.String,
}) {}

export class AgentEgressError extends Schema.TaggedError<AgentEgressError>()("AgentEgressError", {
  url: Schema.String,
  message: Schema.String,
}) {}

export class DevFakeError extends Schema.TaggedError<DevFakeError>()("DevFakeError", {
  message: Schema.String,
}) {}

export class BrowserError extends Schema.TaggedError<BrowserError>()("BrowserError", {
  message: Schema.String,
}) {}

export class JournalRunMissing extends Schema.TaggedError<JournalRunMissing>()("JournalRunMissing", {
  runId: Schema.String,
  message: Schema.String,
}) {}

export class WorkerMissing extends Schema.TaggedError<WorkerMissing>()("WorkerMissing", {
  message: Schema.String,
}) {}

export class AgentFileMissing extends Schema.TaggedError<AgentFileMissing>()("AgentFileMissing", {
  path: Schema.String,
  message: Schema.String,
}) {}
