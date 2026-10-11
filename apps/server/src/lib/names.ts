import { type AgentSlug, isAgentSlug, isRoomId, type RoomId, type UserId } from "@yuki/protocol"
import type { AgentDO } from "../agent/agent-do"
import type { RoomDO } from "../room/room-do"
import type { UserDO } from "../user/user-do"
import { rpc } from "./dev-stats"

// Architecture section 4.2. Every Durable Object name starts with the user id, and the
// Worker builds `user:` and `room:` names only from the session. No code path accepts a
// full name from a client or from model output.

/** The header that carries the session's user id from the Worker to an object. The Worker strips it from client input. */
export const USER_ID_HEADER = "x-yuki-user-id"
/** The human's handle (`humanHandle` of the session name), set by the Worker on a room socket. */
export const HANDLE_HEADER = "x-yuki-handle"
/** The header that carries the room id from the Worker to a `RoomDO`. */
export const ROOM_ID_HEADER = "x-yuki-room-id"

export class NameError extends Error {}

// A Better Auth id is opaque, but it must not contain the separator, or two users could
// build the same name.
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function checkUser(userId: string): UserId {
  if (!USER_ID_PATTERN.test(userId)) throw new NameError("bad user id")
  return userId as UserId
}

function checkRoom(roomId: string): RoomId {
  if (!isRoomId(roomId)) throw new NameError("bad room id")
  return roomId
}

function checkSlug(slug: string): AgentSlug {
  if (!isAgentSlug(slug)) throw new NameError("bad agent slug")
  return slug
}

/** The user id Composio sees: stable for one yuki user, and not the yuki id itself. */
export async function composioUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`composio:${checkUser(userId)}`))
  return `yuki_${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)}`
}

export function userName(userId: string): string {
  return `user:${checkUser(userId)}`
}

export function roomName(userId: string, roomId: string): string {
  return `room:${checkUser(userId)}:${checkRoom(roomId)}`
}

export function agentName(userId: string, roomId: string, slug: string): string {
  return `agent:${checkUser(userId)}:${checkRoom(roomId)}:${checkSlug(slug)}`
}

export function userStub(ns: DurableObjectNamespace<UserDO>, userId: string): DurableObjectStub<UserDO> {
  return rpc(ns.get(ns.idFromName(userName(userId))), "user")
}

export function roomStub(ns: DurableObjectNamespace<RoomDO>, userId: string, roomId: string): DurableObjectStub<RoomDO> {
  return rpc(ns.get(ns.idFromName(roomName(userId, roomId))), "room")
}

/**
 * The stub of one of the session user's rooms, for a Worker HTTP route such as an upload. It
 * records the room in `UserDO` first, so account deletion finds a room that never became a chat.
 * Null once deletion has begun. Throws `NameError` for a bad room id. A socket upgrade skips this
 * hop: `RoomDO` records itself on its first socket.
 *
 * DEVIATION from refusing rooms the chat index does not list: a client creates a chat
 * optimistically and may open its socket before the create reaches `UserDO`, and a
 * deleted chat's room still holds data. Recording keeps one ledger of every room ever
 * reached, and the name still comes only from the session's user id.
 */
export async function addressRoom(
  env: { USER: DurableObjectNamespace<UserDO>; ROOM: DurableObjectNamespace<RoomDO> },
  userId: string,
  roomId: string,
): Promise<DurableObjectStub<RoomDO> | null> {
  const stub = roomStub(env.ROOM, userId, roomId)
  return (await userStub(env.USER, userId).recordRoom(checkRoom(roomId))) ? stub : null
}

/** For `RoomDO` only. It reaches its own agents with the user id and room id the Worker gave it. */
export function agentStub(
  ns: DurableObjectNamespace<AgentDO>,
  userId: string,
  roomId: string,
  slug: string,
): DurableObjectStub<AgentDO> {
  return rpc(ns.get(ns.idFromName(agentName(userId, roomId, slug))), "agent")
}
