
import type { RoomId } from "./ids"
import type { Chat } from "./user"

export const YUKI = "yuki"

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

export const yukiOnly = (chat: Chat): boolean => !chat.agents?.length || (chat.agents.length === 1 && chat.agents[0] === YUKI)

export function duplicateDm(chats: readonly Chat[], op: { roomId: RoomId; agents?: readonly string[]; temp?: true }): RoomId | null {
	if (op.temp) return null
	const agent = op.agents?.length === 1 ? op.agents[0] : undefined
	if (agent === undefined) return null
	const existing = dmFor(chats, agent)
	return existing && existing.roomId !== op.roomId ? existing.roomId : null
}
