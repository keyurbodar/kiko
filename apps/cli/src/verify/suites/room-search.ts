import type { RoomToClient } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// P3-12. Message search in one room. It finds a word in an old message, follows
// an edit, forgets a deleted message, pages, searches chat titles, and answers
// in under 50 ms in a room of 20,000 messages.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function ulid(): string {
	let time = Date.now()
	let head = ""
	for (let i = 0; i < 10; i++) {
		head = CROCKFORD[time % 32] + head
		time = Math.floor(time / 32)
	}
	const tail = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")
	return head + tail
}

const TOTAL = Number(process.env.YUKI_SEARCH_MESSAGES ?? 20_000)
const BUDGET_MS = 50

type Page = Extract<RoomToClient, { t: "search" }>

const suite: Suite = {
	name: "room-search",
	async run(v) {
		// A fresh user per run: the title search spans every chat the user has.
		const s = await v.as(`room-search-${Date.now().toString(36)}`)
		const roomId = ulid()
		const room = await s.room(roomId)
		await room.expect({ t: "events" })

		const search = async (query: string, extra: { before?: number; limit?: number } = {}): Promise<Page> => {
			room.raw.send({ t: "search", query, ...extra })
			const frame = await room.expect({ t: "search", query, ...(extra.before !== undefined ? { before: extra.before } : {}) }, 10_000)
			return frame as Page
		}
		const idOf = async (text: string) => {
			const clientId = room.send(text)
			const ack = await room.expect({ t: "ack", clientId })
			if (ack.t !== "ack") throw new VerifyError("unreachable")
			return ack
		}

		// the old message comes first, then a room full of filler
		const old = await idOf("remember the zanzibar invoice")
		for (let i = 0; i < TOTAL; i++) room.send(`filler number ${i} about nothing in particular`)
		await room.expect((f) => f.t === "ack" && f.seq === old.seq + TOTAL, 120_000)

		// finds a word in an old message, with a snippet and its seq
		let page = await search("zanzibar")
		expectEqual(
			page.results.map((r) => [r.id, r.seq, r.snippet]),
			[[old.id, old.seq, "remember the \u0002zanzibar\u0003 invoice"]],
			"the old message",
		)
		expectEqual(page.next, null, "one page")

		// the last word matches as a prefix, and fts syntax in the query is plain text
		expectEqual((await search("zanzi")).results.length, 1, "a prefix")
		expectEqual((await search('zanzibar" OR "filler')).results.length, 0, "quotes are not syntax")

		// speed, in a room of TOTAL messages. The best of three rounds drops connection noise.
		let best = Infinity
		for (let i = 0; i < 3; i++) {
			const start = performance.now()
			await search("zanzibar")
			best = Math.min(best, performance.now() - start)
		}
		if (TOTAL >= 20_000 && best > BUDGET_MS) throw new VerifyError(`search took ${best.toFixed(1)} ms, over ${BUDGET_MS} ms`)
		console.log(`  search in ${TOTAL} messages: ${best.toFixed(1)} ms`)

		// paging walks newest to oldest and ends with next null
		const first = await search("filler", { limit: 5 })
		expectEqual(first.results.length, 5, "a full page")
		expectEqual(first.results[0]?.seq, old.seq + TOTAL, "newest first")
		const second = await search("filler", { before: first.next ?? 0, limit: 5 })
		expectEqual(second.results[0]?.seq, (first.next ?? 0) - 1, "the next page continues")

		// an edit moves the message in the index
		room.raw.send({ t: "edit", messageId: old.id, text: "remember the madagascar invoice" })
		await room.expect({ t: "events", events: [{ t: "edit" }] })
		expectEqual((await search("zanzibar")).results, [], "the old word is gone after an edit")
		page = await search("madagascar")
		expectEqual(page.results.map((r) => r.id), [old.id], "the new word is found after an edit")

		// a deleted message leaves the index
		room.raw.send({ t: "delete", messageId: old.id })
		await room.expect({ t: "events", events: [{ t: "delete" }] })
		expectEqual((await search("madagascar")).results, [], "nothing after a delete")

		// chat titles, across chats, in the user object
		const user = await s.user()
		await user.expect(() => true)
		const titled = ulid()
		user.send({ t: "chat", op: { op: "create", roomId: titled as never, title: "Quarterly Budget" } })
		await user.expect({ t: "events" })
		user.send({ t: "search", query: "budget quar" })
		const found = await user.expect({ t: "search", query: "budget quar" })
		expectEqual(found.t === "search" && found.chats.map((c) => c.roomId), [titled], "a title match, folded and in any order")
		user.send({ t: "search", query: "zanzibar" })
		const none = await user.expect({ t: "search", query: "zanzibar" })
		expectEqual(none.t === "search" && none.chats, [], "no title match")
	},
}

export default suite
