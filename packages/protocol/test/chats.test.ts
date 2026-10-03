import { describe, expect, test } from "bun:test"
import { dmFor, duplicateDm, kikoOnly } from "../src/chats"
import type { RoomId } from "../src/ids"
import type { Chat } from "../src/user"

const chat = (roomId: string, over: Partial<Chat> = {}): Chat => ({
	roomId: roomId as RoomId,
	title: roomId,
	pinned: false,
	muted: false,
	lastSeq: 0,
	lastPreview: "",
	unread: 0,
	updatedAt: 0,
	...over,
})

describe("an agent's one direct chat", () => {
	const ada = (id: string, updatedAt: number, over: Partial<Chat> = {}) => chat(id, { agents: ["ada"], updatedAt, ...over })
	test.each<[string, Chat[], string, string | null]>([
		["none", [], "ada", null],
		["the one there is", [ada("a", 1)], "ada", "a"],
		["another agent's chat does not count", [chat("b", { agents: ["bob"] })], "ada", null],
		["a group with the agent does not count", [chat("g", { agents: ["kiko", "ada"] })], "ada", null],
		["a temporary chat does not count", [ada("t", 9, { temp: true })], "ada", null],
		["of duplicates, the most recently active", [ada("a", 1), ada("b", 3), ada("c", 2)], "ada", "b"],
		["a tie goes to the lowest room id", [ada("b", 1), ada("a", 1)], "ada", "a"],
		["for kiko, the kiko chat wins over a newer kiko room", [chat("k", { agents: ["kiko"], kiko: true }), chat("old", { agents: ["kiko"], updatedAt: 9 })], "kiko", "k"],
	])("%s", (_, chats, agent, expected) => {
		expect((dmFor(chats, agent)?.roomId ?? null) as string | null).toBe(expected)
	})
})

describe("a create that would make a second direct chat", () => {
	const chats = [chat("a", { agents: ["ada"] })]
	test.each<[string, { roomId: RoomId; agents?: string[]; temp?: true }, string | null]>([
		["a second chat with ada", { roomId: "n" as RoomId, agents: ["ada"] }, "a"],
		["a repeat of the same create", { roomId: "a" as RoomId, agents: ["ada"] }, null],
		["a first chat with bob", { roomId: "n" as RoomId, agents: ["bob"] }, null],
		["a group with ada", { roomId: "n" as RoomId, agents: ["kiko", "ada"] }, null],
		["a temporary chat with ada", { roomId: "n" as RoomId, agents: ["ada"], temp: true }, null],
		["a chat with no agents", { roomId: "n" as RoomId }, null],
	])("%s", (_, op, expected) => {
		expect(duplicateDm(chats, op)).toBe(expected as RoomId | null)
	})
})

describe("rooms with kiko alone", () => {
	test.each<[string, Chat, boolean]>([
		["kiko alone", chat("a", { agents: ["kiko"] }), true],
		["no agents, which seeds kiko", chat("a"), true],
		["another agent", chat("a", { agents: ["ada"] }), false],
		["a group", chat("a", { agents: ["kiko", "ada"] }), false],
	])("%s", (_, c, expected) => {
		expect(kikoOnly(c)).toBe(expected)
	})
})
