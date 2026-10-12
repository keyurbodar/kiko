import { newRoomId } from "@yuki/protocol"
import type { RoomEvent, RoomToClient } from "@yuki/protocol"
import { ClientToRoom, RoomToClient as RoomToClientSchema } from "@yuki/protocol/schema"
import { Channel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"


/** workerd evicts an idle object after about 10 s. The sockets stay open and the room hibernates. */
const HIBERNATE_MS = Number(process.env.YUKI_HIBERNATE_MS ?? 12_000)


type In = RoomToClient
const isEvents = (f: In): f is Extract<In, { t: "events" }> => f.t === "events"
const kinds = (events: readonly RoomEvent[]) => events.map((e) => `${e.seq}:${e.t}`)

const suite: Suite = {
	name: "room-sync",
	async run(v) {
		const s = await v.as("room-sync")
		const roomId = newRoomId()
		const phone = await s.room(roomId)
		const laptop = await s.room(roomId)
		expectEqual(await phone.expect(isEvents), { t: "events", events: [] }, "a new room replays nothing")
		await laptop.expect(isEvents)

		const first = phone.send("hello from the phone")
		const ack = await phone.expect({ t: "ack", clientId: first })
		if (ack.t !== "ack") throw new VerifyError("unreachable")
		expectEqual(ack.seq, 1, "the first message's seq")
		const message = await laptop.expect({ t: "events" })
		expectEqual(
			isEvents(message) && message.events.map((e) => (e.t === "message" ? [e.seq, e.clientId, e.text, e.from] : e.t)),
			[[1, first, "hello from the phone", { kind: "human" }]],
			"the broadcast message",
		)
		await phone.expect(isEvents)

		phone.raw.send({ t: "send", clientId: first, text: "hello from the phone" })
		expectEqual(await phone.expect({ t: "ack", clientId: first }), ack, "the repeated ack")
		await laptop.expectNone(isEvents, 500)

		laptop.raw.send({ t: "edit", messageId: ack.id, text: "hello, edited" })
		laptop.raw.send({ t: "react", messageId: ack.id, emoji: "👍" })
		const edit = (await phone.expect({ t: "events", events: [{ t: "edit" }] })) as Extract<In, { t: "events" }>
		expectEqual(edit.events[0], { ...edit.events[0], seq: 2, messageId: ack.id, text: "hello, edited" }, "the edit")
		const react = (await phone.expect({ t: "events", events: [{ t: "react" }] })) as Extract<In, { t: "events" }>
		expectEqual(react.events[0], { ...react.events[0], seq: 3, by: { kind: "human" }, emoji: "👍" }, "the reaction")

		phone.raw.send({ t: "typing" })

		await Bun.sleep(HIBERNATE_MS)
		const second = laptop.send("after the nap")
		const ack2 = await laptop.expect({ t: "ack", clientId: second }, 10_000)
		expectEqual(ack2.t === "ack" && ack2.seq, 4, "the seq after hibernation")
		await phone.expect({ t: "events", events: [{ t: "message", seq: 4, clientId: second }] }, 10_000)
		await laptop.expect(isEvents)

		phone.raw.close()
		laptop.raw.send({ t: "delete", messageId: ack.id })
		laptop.raw.send({ t: "react", messageId: ack2.t === "ack" ? ack2.id : ack.id, emoji: "🔥" })
		laptop.raw.send({ t: "read", seq: 6 })
		const third = laptop.send("while you were away")
		await laptop.expect({ t: "ack", clientId: third })

		const resumed = new Channel<In, typeof ClientToRoom.Type>(
			`${s.name}/room ${roomId} resumed`,
			wsUrl(v.url, `api/ws/room/${roomId}`),
			s.cookie,
			RoomToClientSchema,
			ClientToRoom,
			{ t: "hello", lastSeq: 4 },
		)
		try {
			await resumed.connect()
			const missed = (await resumed.expect(isEvents)) as Extract<In, { t: "events" }>
			expectEqual(kinds(missed.events), ["5:delete", "6:react", "7:read", "8:message"], "the missed events")
			expectEqual(missed.events[0], { ...missed.events[0], messageIds: [ack.id] }, "the delete")
			expectEqual(missed.events[2], { ...missed.events[2], upTo: 6 }, "the read mark")
			expectEqual(missed.events[3], { ...missed.events[3], clientId: third, text: "while you were away" }, "the message")

			resumed.send({ t: "hello", lastSeq: 9999 })
			const reset = await resumed.expect({ t: "reset" })
			if (reset.t !== "reset") throw new VerifyError("unreachable")
			expectEqual(
				reset.snapshot.messages.map((m) => [m.seq, m.text, m.reactions?.map((r) => r.emoji) ?? []]),
				[
					[4, "after the nap", ["🔥"]],
					[8, "while you were away", []],
				],
				"the snapshot after a delete",
			)
			expectEqual([reset.snapshot.seq, reset.snapshot.readSeq], [8, 6], "the snapshot cursors")
		} finally {
			resumed.close()
		}
	},
}

function wsUrl(base: string, path: string): URL {
	const u = new URL(path, base)
	u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
	return u
}

export default suite
