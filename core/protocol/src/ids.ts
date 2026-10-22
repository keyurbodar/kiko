import { v7 } from "uuid"

declare const brand: unique symbol
type Brand<Name extends string> = string & { readonly [brand]: Name }

export type UserId = Brand<"UserId">
export type RoomId = Brand<"RoomId">
export type MessageId = Brand<"MessageId">
export type AgentSlug = Brand<"AgentSlug">

export const AGENT_SLUG_PATTERN = /^[a-z0-9-]{1,32}$/

export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

export const isAgentSlug = (value: string): value is AgentSlug => AGENT_SLUG_PATTERN.test(value)

export const isRoomId = (value: string): value is RoomId => UUID_V7_PATTERN.test(value) || ULID_PATTERN.test(value)

const roomKey = (roomId: string) => Array.from(new TextEncoder().encode(roomId), (byte) => byte.toString(16).padStart(2, "0")).join("")

export const messageIdAt = (roomId: string, seq: number): MessageId => `${seq}.${roomKey(roomId)}` as MessageId

export function messageSeq(roomId: string, id: string): number {
	const seq = Number(id.slice(0, id.indexOf(".")))
	return Number.isSafeInteger(seq) && seq > 0 && messageIdAt(roomId, seq) === id ? seq : -1
}

export function newRoomId(now?: number, random?: Uint8Array): RoomId {
	if (now === undefined && !random) return v7() as RoomId
	return v7({ ...(now === undefined ? {} : { msecs: now }), ...(random ? { random } : {}) }) as RoomId
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

function roomIdTime(roomId: string): number | null {
	if (UUID_V7_PATTERN.test(roomId)) return Number.parseInt(roomId.slice(0, 8) + roomId.slice(9, 13), 16)
	if (!ULID_PATTERN.test(roomId)) return null
	let time = 0
	for (const char of roomId.slice(0, 10)) time = time * 32 + CROCKFORD.indexOf(char)
	return time
}

export function tagline(description: string): string {
	const line = description.trim().split(/\n/)[0] ?? ""
	const first = (line.split(/(?<=[.!?])\s/)[0] ?? "").trim()
	return first.length > 100 ? `${first.slice(0, 99).trimEnd()}…` : first
}
