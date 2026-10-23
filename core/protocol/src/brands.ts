import * as Schema from "effect/Schema"
import { Id } from "./base"
import { AGENT_SLUG_PATTERN, ULID_PATTERN, UUID_V7_PATTERN } from "./ids"

export const UserId = Id.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type
export const RoomId = Schema.String.check(
  Schema.makeFilter((value: string) => UUID_V7_PATTERN.test(value) || ULID_PATTERN.test(value)),
).pipe(Schema.brand("RoomId"))
export type RoomId = typeof RoomId.Type
export const MessageId = Id.pipe(Schema.brand("MessageId"))
export type MessageId = typeof MessageId.Type
export const AgentSlug = Schema.String.check(Schema.isPattern(AGENT_SLUG_PATTERN)).pipe(Schema.brand("AgentSlug"))
export type AgentSlug = typeof AgentSlug.Type
export const CommandId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)).pipe(
  Schema.brand("CommandId"),
)
export type CommandId = typeof CommandId.Type
