// Branded ids. A brand exists only in the type checker, so a `RoomId` cannot be
// passed where a `MessageId` is expected, and the wire value stays a string.

declare const brand: unique symbol
type Brand<Name extends string> = string & { readonly [brand]: Name }

/** The Better Auth user id. Opaque. It comes from the session, never from a frame. */
export type UserId = Brand<"UserId">
/** A ULID that the client generates, so a new chat exists before the server hears of it. */
export type RoomId = Brand<"RoomId">
/** Assigned by the room when it stores a message. Opaque. */
export type MessageId = Brand<"MessageId">
/** An agent's name in its room. `all` in a mention addresses every agent. */
export type AgentSlug = Brand<"AgentSlug">

/** Architecture section 4.2. */
export const AGENT_SLUG_PATTERN = /^[a-z0-9-]{1,32}$/

/** A canonical ULID: 26 Crockford base32 characters, the first at most 7. */
export const ROOM_ID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

export const isAgentSlug = (value: string): value is AgentSlug => AGENT_SLUG_PATTERN.test(value)

export const isRoomId = (value: string): value is RoomId => ROOM_ID_PATTERN.test(value)
