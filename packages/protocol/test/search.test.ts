import { describe, expect, test } from "bun:test"
import { type ChatSearchHit, mergeHits, type RoomId, snippetParts, snippetText } from "../src"

const O = "\u0002"
const C = "\u0003"

describe("snippetParts", () => {
	test("splits marked words from plain text, in order", () => {
		expect(snippetParts(`the ${O}quick${C} brown ${O}fox${C}`)).toEqual([
			{ text: "the ", match: false },
			{ text: "quick", match: true },
			{ text: " brown ", match: false },
			{ text: "fox", match: true },
		])
	})
	test("joins adjacent matches and drops empty runs", () => {
		expect(snippetParts(`${O}a${C}${O}b${C}`)).toEqual([{ text: "ab", match: true }])
		expect(snippetParts("")).toEqual([])
	})
	test("an unclosed mark highlights to the end, and text without marks is one plain run", () => {
		expect(snippetParts(`…say ${O}hel`)).toEqual([
			{ text: "…say ", match: false },
			{ text: "hel", match: true },
		])
		expect(snippetParts("plain")).toEqual([{ text: "plain", match: false }])
	})
	test("keeps surrogate pairs whole", () => {
		expect(snippetText(`${O}🔥${C} hot`)).toBe("🔥 hot")
	})
})

describe("mergeHits", () => {
	const hit = (roomId: string, seq: number, at: number): ChatSearchHit => ({
		roomId: roomId as RoomId,
		id: `${roomId}-${seq}` as never,
		seq,
		at,
		from: { kind: "human" },
		snippet: "",
	})
	test("orders every chat's hits newest first and keeps the limit", () => {
		const out = mergeHits(
			[
				{ results: [hit("a", 9, 900), hit("a", 3, 300)], more: false },
				{ results: [hit("b", 5, 500), hit("b", 1, 100)], more: false },
			],
			3,
		)
		expect(out.results.map((r) => `${r.roomId}${r.seq}`)).toEqual(["a9", "b5", "a3"])
		expect(out.next).toBe(300)
	})
	test("next is null when every chat is done and nothing was cut", () => {
		const out = mergeHits([{ results: [hit("a", 1, 100)], more: false }, { results: [], more: false }], 5)
		expect(out).toEqual({ results: [hit("a", 1, 100)], next: null })
	})
	test("a chat with more keeps paging open", () => {
		expect(mergeHits([{ results: [hit("a", 1, 100)], more: true }], 5).next).toBe(100)
		expect(mergeHits([{ results: [], more: true }], 5).next).toBeNull()
	})
	test("ties on time break by room, then newest seq, so the order is stable", () => {
		const out = mergeHits([{ results: [hit("b", 2, 100)], more: false }, { results: [hit("a", 1, 100), hit("a", 2, 100)], more: false }], 5)
		expect(out.results.map((r) => `${r.roomId}${r.seq}`)).toEqual(["a2", "a1", "b2"])
	})
})
