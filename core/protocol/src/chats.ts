import type { RoomId } from "./ids"
import type { Chat } from "./user"

export const KIKO = "yuki"

/** Two agent lists name the same chat when they hold the same agents, in any order, with repeats counted once. */
export function sameAgents(a: readonly string[], b: readonly string[]): boolean {
	const x = new Set(a)
	const y = new Set(b)
	return x.size > 0 && x.size === y.size && [...x].every((id) => y.has(id))
}

/**
 * The chat that already holds exactly these agents, or null. A create that would make a second
 * one (a direct chat with one agent, the kiko chat with kiko alone, or a group) gets this room
 * back instead. Of several, the kiko chat wins, then the most recently active, then the lowest id.
 */
export function sameAgentChat(chats: readonly Chat[], agents: readonly string[], except?: RoomId): Chat | null {
	let best: Chat | null = null
	for (const c of chats) {
		if (c.roomId === except || !sameAgents(c.agents ?? [], agents)) continue
		if (!best || rank(c, best) < 0) best = c
	}
	return best
}

/** The agent's one direct chat, or null. */
export const dmFor = (chats: readonly Chat[], agentId: string): Chat | null => sameAgentChat(chats, [agentId])

const rank = (a: Chat, b: Chat) => Number(!!b.kiko) - Number(!!a.kiko) || b.updatedAt - a.updatedAt || (a.roomId < b.roomId ? -1 : 1)

export const kikoOnly = (chat: Chat): boolean => !chat.agents?.length || (chat.agents.length === 1 && chat.agents[0] === KIKO)
