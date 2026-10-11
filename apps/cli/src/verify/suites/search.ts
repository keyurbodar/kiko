import { type ChatSearchPage, newRoomId, type RoomToClient, snippetText } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import { must } from "../must"
import type { Suite } from "../runner"


type Page = Extract<RoomToClient, { t: "search" }>
type History = Extract<RoomToClient, { t: "history" }>

const suite: Suite = {
	name: "search",
	async run(v) {
		const s = await v.as(`search-${Date.now().toString(36)}`)
		const word = `quokka${Date.now().toString(36)}`
		const user = await s.user()
		await user.expect(() => true)
		const rooms = [newRoomId(), newRoomId()]
		for (const [i, roomId] of rooms.entries()) {
			user.send({ t: "chat", op: { op: "create", roomId, title: `search ${i}` } })
			await user.expect({ t: "events" })
		}

		const sendAll = async (room: Awaited<ReturnType<typeof s.room>>, texts: string[]) => {
			const acks: { id: string; seq: number }[] = []
			for (const text of texts) {
				const clientId = room.send(text)
				const ack = await room.expect({ t: "ack", clientId })
				if (ack.t !== "ack") throw new VerifyError("unreachable")
				acks.push(ack)
			}
			return acks
		}

		const a = await s.room(must(rooms[0], "the first chat id"))
		await a.expect({ t: "events" })
		const fillers = Array.from({ length: 40 }, (_, i) => `line ${i}`)
		const aAcks = await sendAll(a, [`the ${word} in the first chat`, ...fillers])
		const b = await s.room(must(rooms[1], "the second chat id"))
		await b.expect({ t: "events" })
		const bAcks = await sendAll(b, ["hello", `a ${word} in the second chat`])

		a.raw.send({ t: "search", query: word })
		const page = (await a.expect({ t: "search", query: word })) as Page
		expectEqual(page.results.map((r) => r.id), [aAcks[0]?.id], "the current chat's hit")
		expectEqual(page.results[0]?.snippet, `the \u0002${word}\u0003 in the first chat`, "a marked snippet")
		expectEqual(page.results[0]?.from, { kind: "human" }, "the sender")

		const res = await fetch(new URL(`api/search?q=${encodeURIComponent(word)}`, v.url.endsWith("/") ? v.url : `${v.url}/`), {
			headers: { cookie: s.cookie },
			signal: AbortSignal.timeout(10_000),
		})
		if (!res.ok) throw new VerifyError(`GET api/search answered ${res.status}`)
		const all = (await res.json()) as ChatSearchPage
		expectEqual(
			all.results.map((r) => [r.roomId, r.id, snippetText(r.snippet)]),
			[
				[rooms[1], bAcks[1]?.id, `a ${word} in the second chat`],
				[rooms[0], aAcks[0]?.id, `the ${word} in the first chat`],
			],
			"hits in both chats, newest first",
		)
		expectEqual([all.next, all.partial], [null, false], "one page, every chat searched")

		const target = must(aAcks[10], "the tenth message ack")
		a.raw.send({ t: "history", seq: target.seq, before: 3, after: 3 })
		const around = (await a.expect({ t: "history", seq: target.seq })) as History
		expectEqual(
			around.messages.map((m) => m.text),
			["line 6", "line 7", "line 8", "line 9", "line 10", "line 11"],
			"three before the hit, the hit, and two after",
		)
		expectEqual(around.messages[3]?.id, target.id, "the hit is in the window")
		a.raw.send({ t: "history", seq: aAcks[1]?.seq, before: 50, after: 0 })
		const start = (await a.expect({ t: "history", seq: aAcks[1]?.seq, after: 0 })) as History
		expectEqual(start.messages.map((m) => m.id), [aAcks[0]?.id], "only the first message is older")
	},
}

export default suite
