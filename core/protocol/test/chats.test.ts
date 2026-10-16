import { describe, expect, test } from "bun:test"
import { pairRoomId, sameAgentChat, sameAgents } from "../src/chats"
import { isRoomId, type RoomId } from "../src/ids"
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
		["of duplicates, the most recently active", [ada("a", 1), ada("b", 3), ada("c", 2)], "ada", "b"],
		["a tie goes to the lowest room id", [ada("b", 1), ada("a", 1)], "ada", "a"],
		["for kiko, the kiko chat wins over a newer kiko room", [chat("k", { agents: ["kiko"], kiko: true }), chat("old", { agents: ["kiko"], updatedAt: 9 })], "kiko", "k"],
	])("%s", (_, chats, agent, expected) => {
		expect((sameAgentChat(chats, [agent])?.roomId ?? null) as string | null).toBe(expected)
	})
})

describe("a create that would make a second chat with the same agents", () => {
	const chats = [chat("a", { agents: ["ada"] }), chat("g", { agents: ["kiko", "ada", "bob"] })]
	test.each<[string, string[], RoomId | undefined, string | null]>([
		["a second direct chat with ada", ["ada"], undefined, "a"],
		["the same direct chat again", ["ada"], "a" as RoomId, null],
		["a first chat with carol", ["carol"], undefined, null],
		["a group that exists, in another order", ["bob", "kiko", "ada"], undefined, "g"],
		["a group with a repeat in it", ["ada", "ada", "bob", "kiko"], undefined, "g"],
		["a group that is not there yet", ["kiko", "ada"], undefined, null],
		["a chat with no agents", [], undefined, null],
	])("%s", (_, agents, roomId, expected) => {
		expect(sameAgentChat(chats, agents, roomId)?.roomId ?? null).toBe(expected as RoomId | null)
	})

	test("a kiko-alone create finds the kiko chat", () => {
		const kiko = [chat("k", { agents: ["kiko"], kiko: true })]
		expect(sameAgentChat(kiko, ["kiko"])?.roomId).toBe("k" as RoomId)
	})
})

describe("two agent lists name one chat", () => {
	test.each<[string, string[], string[], boolean]>([
		["the same agents", ["ada", "bob"], ["ada", "bob"], true],
		["in another order", ["ada", "bob"], ["bob", "ada"], true],
		["with a repeat", ["ada", "ada"], ["ada"], true],
		["with an agent more", ["ada", "bob"], ["ada"], false],
		["with an agent less", ["ada"], ["ada", "bob"], false],
		["an empty list", [], [], false],
	])("%s", (_, a, b, expected) => {
		expect(sameAgents(a, b)).toBe(expected)
	})
})

describe("the pair room of two agents", () => {
	test("is one valid room id whatever the order", () => {
		const id = pairRoomId("ada", "bob")
		expect(isRoomId(id)).toBe(true)
		expect(pairRoomId("bob", "ada")).toBe(id)
	})
	test("differs for every pair", () => {
		const ids = [pairRoomId("ada", "bob"), pairRoomId("ada", "kiko"), pairRoomId("a-b", "c"), pairRoomId("a", "b-c"), pairRoomId("bob", "kiko")]
		expect(new Set(ids).size).toBe(ids.length)
	})
})

test("a pair chat is never the chat that already holds its agents", () => {
	const chats = [chat("p", { agents: ["a", "b"], pair: true }), chat("g", { agents: ["a", "b"], updatedAt: 1 })]
	expect(sameAgentChat(chats, ["b", "a"])?.roomId).toBe("g")
	expect(sameAgentChat([chats[0]!], ["a", "b"])).toBeNull()
})
