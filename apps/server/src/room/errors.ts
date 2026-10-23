import * as Schema from "effect/Schema"

export class RoomClosed extends Schema.TaggedError<RoomClosed>()("RoomClosed", {
  message: Schema.String,
}) {}

export class RoomIdentityError extends Schema.TaggedError<RoomIdentityError>()("RoomIdentityError", {
  message: Schema.String,
}) {}

export class GroupRefused extends Schema.TaggedError<GroupRefused>()("GroupRefused", {
  reason: Schema.Literals(["not_chief", "not_member", "not_yours", "could_not_make", "no_home"]),
  message: Schema.String,
}) {}

export class InboxFull extends Schema.TaggedError<InboxFull>()("InboxFull", {
  recipient: Schema.String,
  message: Schema.String,
}) {}

export class ReceiveError extends Schema.TaggedError<ReceiveError>()("ReceiveError", {
  message: Schema.String,
}) {}

export class WorkspaceTaskError extends Schema.TaggedError<WorkspaceTaskError>()("WorkspaceTaskError", {
  taskId: Schema.String,
  message: Schema.String,
}) {}

export class MemoryNapError extends Schema.TaggedError<MemoryNapError>()("MemoryNapError", {
  message: Schema.String,
}) {}
