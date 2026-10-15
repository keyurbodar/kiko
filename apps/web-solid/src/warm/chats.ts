// The chat list and the user socket's cursor.

import type { Agent, Chat, RoomId } from "@kiko/protocol"
import type { Home } from "../sync/user-store"
import type { Warm } from "./db"
import { clearDraft } from "./drafts"
import { clearRoom } from "./messages"

const USER_SEQ = "userSeq"
const AGENTS = "agents"
const HOME = "home"

export function putChats(warm: Warm, chats: readonly Chat[]) {
	for (const c of chats) warm.put("chats", c.roomId, c)
}

/** Pinned first, then the most recently updated. */
export async function allChats(warm: Warm): Promise<Chat[]> {
	const chats = await warm.getAll<Chat>("chats")
	return chats.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

/** Removes the chat with its messages, cursor, and draft. */
export function removeChat(warm: Warm, roomId: RoomId) {
	warm.delete("chats", roomId)
	clearRoom(warm, roomId)
	clearDraft(warm, roomId)
}

/** Replaces the whole chat list, as on a user `reset` frame. */
export function replaceChats(warm: Warm, chats: readonly Chat[], seq: number) {
	warm.clear("chats")
	putChats(warm, chats)
	setUserSeq(warm, seq)
}

/** 0 when the user socket has never synced on this device. */
export async function getUserSeq(warm: Warm): Promise<number> {
	return (await warm.get<number>("meta", USER_SEQ)) ?? 0
}

export function setUserSeq(warm: Warm, seq: number) {
	warm.put("meta", USER_SEQ, seq)
}

/** The user's agents, kept as one list under one key. */
export const putAgents = (warm: Warm, agents: readonly Agent[]) => warm.put("meta", AGENTS, agents)

export async function allAgents(warm: Warm): Promise<Agent[]> {
	return [...((await warm.get<Agent[]>("meta", AGENTS)) ?? [])]
}

export const putHome = (warm: Warm, home: Home) => warm.put("meta", HOME, home)

export const getHome = (warm: Warm): Promise<Home | undefined> => warm.get<Home>("meta", HOME)
