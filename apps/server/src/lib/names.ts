import { type AgentSlug, isAgentSlug, isRoomId, type RoomId, type UserId } from "@kiko/protocol"
import type { AgentDO } from "../agent/agent-do"
import type { FileDO } from "../files/file-do"
import type { RoomDO } from "../room/room-do"
import type { UserDO } from "../user/user-do"
import { rpc } from "./dev-guard"

export const USER_ID_HEADER = "x-kiko-user-id"
export const HANDLE_HEADER = "x-kiko-handle"
export const ROOM_ID_HEADER = "x-kiko-room-id"

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

export async function composioUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`composio:${checkUser(userId)}`))
  return `kiko_${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)}`
}

export function userName(userId: string): string {
  return `user:${checkUser(userId)}`
}

export function roomName(userId: string, roomId: string): string {
  return `room:${checkUser(userId)}:${checkRoom(roomId)}`
}

export function fileName(userId: string, spaceId: string): string {
  return `files:${checkUser(userId)}:${spaceId === "home" ? spaceId : checkRoom(spaceId)}`
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

export function agentStub(
  ns: DurableObjectNamespace<AgentDO>,
  userId: string,
  roomId: string,
  slug: string,
): DurableObjectStub<AgentDO> {
  return rpc(ns.get(ns.idFromName(agentName(userId, roomId, slug))), "agent")
}

export function fileStub(ns: DurableObjectNamespace<FileDO>, userId: string, spaceId: string): DurableObjectStub<FileDO> {
  return rpc(ns.get(ns.idFromName(fileName(userId, spaceId))), "file")
}
