
import { newRoomId } from "@kiko/protocol"
import type { RoomToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"



const TOTAL = Number(process.env.KIKO_SEARCH_MESSAGES ?? 20_000)
const BUDGET_MS = 50

type Page = Extract<RoomToClient, { t: "search" }>

const suite: Suite = {
	name: "room-search",
	load: true,
	async run(v) {
		const s = await v.as(`room-search-${Date.now().toString(36)}`)
		const roomId = newRoomId()
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

		const old = await idOf("remember the zanzibar invoice")
		for (let i = 0; i < TOTAL; i++) room.send(`filler number ${i} about nothing in particular`)
		await room.expect((f) => f.t === "ack" && f.seq === old.seq + TOTAL, 120_000)

		let page = await search("zanzibar")
		expectEqual(
			page.results.map((r) => [r.id, r.seq, r.snippet]),
			[[old.id, old.seq, "remember the \u0002zanzibar\u0003 invoice"]],
			"the old message",
		)
		expectEqual(page.next, null, "one page")

		expectEqual((await search("zanzi")).results.length, 1, "a prefix")
		expectEqual((await search('zanzibar" OR "filler')).results.length, 0, "quotes are not syntax")

		let best = Infinity
		for (let i = 0; i < 3; i++) {
			const start = performance.now()
			await search("zanzibar")
			best = Math.min(best, performance.now() - start)
		}
		if (TOTAL >= 20_000 && best > BUDGET_MS) throw new VerifyError(`search took ${best.toFixed(1)} ms, over ${BUDGET_MS} ms`)
		console.log(`  search in ${TOTAL} messages: ${best.toFixed(1)} ms`)

		const first = await search("filler", { limit: 5 })
		expectEqual(first.results.length, 5, "a full page")
		expectEqual(first.results[0]?.seq, old.seq + TOTAL, "newest first")
		const second = await search("filler", { before: first.next ?? 0, limit: 5 })
		expectEqual(second.results[0]?.seq, (first.next ?? 0) - 1, "the next page continues")

		room.raw.send({ t: "edit", messageId: old.id, text: "remember the madagascar invoice" })
		await room.expect({ t: "events", events: [{ t: "edit" }] })
		expectEqual((await search("zanzibar")).results, [], "the old word is gone after an edit")
		page = await search("madagascar")
		expectEqual(page.results.map((r) => r.id), [old.id], "the new word is found after an edit")

		room.raw.send({ t: "delete", messageId: old.id })
		await room.expect({ t: "events", events: [{ t: "delete" }] })
		expectEqual((await search("madagascar")).results, [], "nothing after a delete")

		const user = await s.user()
		await user.expect(() => true)
		const titled = newRoomId()
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
