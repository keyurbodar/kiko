import * as Schema from "effect/Schema"

export class JournalCorrupt extends Schema.TaggedError<JournalCorrupt>()("JournalCorrupt", {
  reason: Schema.Literals([
    "incomplete_commit",
    "parts",
    "byte_length",
    "envelope",
    "batch",
    "commit",
    "handoff",
    "restart_input",
  ]),
  message: Schema.String,
}) {}

export class JournalClosed extends Schema.TaggedError<JournalClosed>()("JournalClosed", {
  message: Schema.String,
}) {}

export class IdSpaceExhausted extends Schema.TaggedError<IdSpaceExhausted>()("IdSpaceExhausted", {
  message: Schema.String,
}) {}

export class InvocationBusy extends Schema.TaggedError<InvocationBusy>()("InvocationBusy", {
  message: Schema.String,
}) {}

export class WorkerMissing extends Schema.TaggedError<WorkerMissing>()("WorkerMissing", {
  message: Schema.String,
}) {}
