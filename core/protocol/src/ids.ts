import * as Schema from "effect/Schema"
import { v7 } from "uuid"
import { Id } from "./base"

export const AGENT_SLUG_PATTERN = /^[a-z0-9-]{1,32}$/

export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

const roomIdShape = (value: string) => UUID_V7_PATTERN.test(value) || ULID_PATTERN.test(value)

export const UserId = Id.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type
export const RoomId = Schema.String.check(Schema.makeFilter(roomIdShape)).pipe(Schema.brand("RoomId"))
export type RoomId = typeof RoomId.Type
export const MessageId = Id.pipe(Schema.brand("MessageId"))
export type MessageId = typeof MessageId.Type
export const AgentSlug = Schema.String.check(Schema.isPattern(AGENT_SLUG_PATTERN)).pipe(Schema.brand("AgentSlug"))
export type AgentSlug = typeof AgentSlug.Type
export const CommandId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)).pipe(
  Schema.brand("CommandId"),
)
export type CommandId = typeof CommandId.Type

export const isAgentSlug = (value: string): value is AgentSlug => AGENT_SLUG_PATTERN.test(value)

export const isRoomId = (value: string): value is RoomId => roomIdShape(value)

const roomKey = (roomId: string) =>
  Array.from(new TextEncoder().encode(roomId), (byte) => byte.toString(16).padStart(2, "0")).join("")

export const messageIdAt = (roomId: string, seq: number): MessageId => `${seq}.${roomKey(roomId)}` as MessageId

export function messageSeq(roomId: string, id: string): number {
  const seq = Number(id.slice(0, id.indexOf(".")))
  return Number.isSafeInteger(seq) && seq > 0 && messageIdAt(roomId, seq) === id ? seq : -1
}

export function newRoomId(now?: number, random?: Uint8Array): RoomId {
  if (now === undefined && !random) return v7() as RoomId
  return v7({ ...(now === undefined ? {} : { msecs: now }), ...(random ? { random } : {}) }) as RoomId
}

export function tagline(description: string): string {
  const line = description.trim().split(/\n/)[0] ?? ""
  const first = (line.split(/(?<=[.!?])\s/)[0] ?? "").trim()
  return first.length > 100 ? `${first.slice(0, 99).trimEnd()}…` : first
}
