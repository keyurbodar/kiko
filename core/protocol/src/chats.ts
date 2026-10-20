import type { RoomId } from "./ids"
import type { Chat } from "./user"

export const KIKO = "kiko"

/** The room id of the Kiko chat a new account gets. Fixed, so the client can paint the pinned tile before the server answers. */
export const KIKO_HOME_ROOM = "00000000-0000-7000-8000-6b696b6f0000" as RoomId

/** Two agent lists name the same chat when they hold the same agents, in any order, with repeats counted once. */
function sameAgents(a: readonly string[], b: readonly string[]): boolean {
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
		if (c.pair || c.roomId === except || !sameAgents(c.agents ?? [], agents)) continue
		if (!best || rank(c, best) < 0) best = c
	}
	return best
}

const rank = (a: Chat, b: Chat) => Number(!!b.kiko) - Number(!!a.kiko) || b.updatedAt - a.updatedAt || (a.roomId < b.roomId ? -1 : 1)

/**
 * The room id of the hidden chat where two agents talk privately. It depends only on the two slugs, in any order, so
 * every send between the same pair reaches the same room. It is shaped like a UUIDv7 with a zero time, as the Kiko chat is.
 */
export function pairRoomId(a: string, b: string): RoomId {
	const [x, y] = a < b ? [a, b] : [b, a]
	const key = `pair:${x}:${y}`
	let h = [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344]
	for (let i = 0; i < key.length; i++) {
		const c = key.charCodeAt(i)
		h = [Math.imul(h[0]! ^ c, 0x9e3779b1), Math.imul(h[1]! ^ c, 0x85ebca6b), Math.imul(h[2]! ^ c, 0xc2b2ae35), Math.imul(h[3]! ^ c, 0x27d4eb2f)]
		h = [h[1]! ^ (h[0]! >>> 15), h[2]! ^ (h[1]! >>> 13), h[3]! ^ (h[2]! >>> 16), h[0]! ^ (h[3]! >>> 11)]
	}
	const hex = h.map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("")
	return `00000000-0000-7${hex.slice(0, 3)}-8${hex.slice(3, 6)}-${hex.slice(6, 18)}` as RoomId
}
