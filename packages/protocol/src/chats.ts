// Pure rules about the chat list that the server and the client both apply, so the two agree
// on which chat is an agent's one direct chat.

import type { RoomId } from "./ids"
import type { Chat } from "./user"

/** The built-in agent's id and slug. Its direct chat is the yuki chat. */
export const YUKI = "yuki"

/** True when `chat` is a direct chat with the agent `agentId`: one agent, and not temporary. */
export const isDmOf = (chat: Chat, agentId: string): boolean => !chat.temp && chat.agents?.length === 1 && chat.agents[0] === agentId

/**
 * The agent's one direct chat, or null. Old data can hold several for one agent; the one that
 * counts is the yuki chat for yuki, else the most recently active, else the lowest room id.
 */
export function dmFor(chats: readonly Chat[], agentId: string): Chat | null {
	let best: Chat | null = null
	for (const c of chats) {
		if (!isDmOf(c, agentId)) continue
		if (!best || rank(c, best) < 0) best = c
	}
	return best
}

const rank = (a: Chat, b: Chat) => Number(!!b.yuki) - Number(!!a.yuki) || b.updatedAt - a.updatedAt || (a.roomId < b.roomId ? -1 : 1)

/** A room whose only agent is yuki: the yuki chat, or an old draft or second yuki chat. A chat made with no agents gets yuki alone. */
export const yukiOnly = (chat: Chat): boolean => !chat.agents?.length || (chat.agents.length === 1 && chat.agents[0] === YUKI)

/** The room id a create of `agents` would duplicate, or null. Only a direct chat (one agent, not temporary) can. */
export function duplicateDm(chats: readonly Chat[], op: { roomId: RoomId; agents?: readonly string[]; temp?: true }): RoomId | null {
	if (op.temp || op.agents?.length !== 1) return null
	const existing = dmFor(chats, op.agents[0]!)
	return existing && existing.roomId !== op.roomId ? existing.roomId : null
}
