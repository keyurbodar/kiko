import type { RoomEvent } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, newRoom } from "./mid-run"

// A human message past the bubble limit: the room shows the first 16,000 characters and stores the
// whole text as a file. The file's bytes come back whole, and the agent's transcript takes the message.

const suite: Suite = {
	name: "long-text",
	async run(v) {
		const alice = await v.as("long-text-alice")
		const { roomId, room } = await newRoom(alice, "long text")
		await fake(v, alice, roomId)
		const text = "0123456789".repeat(4_000)
		const clientId = crypto.randomUUID()
		room.raw.send({ t: "send", clientId, text })
		const ack = await room.expect((f) => (f.t === "ack" || f.t === "send_refused") && f.clientId === clientId, 10_000)
		if (ack.t !== "ack") throw new VerifyError(`the send was refused: ${ack.t === "send_refused" ? ack.reason : ""}`)
		const stored = await room.expect((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.clientId === clientId), 10_000)
		const events = stored.t === "events" ? stored.events : []
		const message = events.find((e): e is Extract<RoomEvent, { t: "message" }> => e.t === "message" && e.clientId === clientId)
		expectEqual(message?.text.length, 16_000, "the bubble's length")
		const files = message?.files ?? []
		expectEqual(files.map((f) => [f.size, f.type]), [[40_000, "text/plain"]], "the message's files")
		const file = files[0]
		if (!file || !/^attachments\/[0-9a-z]+-message\.txt$/.test(file.name)) throw new VerifyError(`the file is at ${file?.name}`)
		const base = v.url.endsWith("/") ? v.url : `${v.url}/`
		const download = await fetch(new URL(`api/files/${roomId}/${file.id}`, base), { headers: { cookie: alice.cookie } })
		expectEqual(await download.text(), text, "the file's bytes")

		// The agent's transcript takes the message. Its entry is longer than the bubble, since the
		// envelope adds the attached line. The trace cuts each entry to 300 characters, so the line itself is not read here.
		const deadline = Date.now() + 20_000
		for (;;) {
			const trace = await fetch(new URL("api/dev/agent/trace", base), {
				method: "POST",
				headers: { "content-type": "application/json", cookie: alice.cookie },
				body: JSON.stringify({ roomId }),
			})
			const entries = trace.ok ? ((await trace.json()) as { chars: number }[]) : []
			if (entries.some((e) => e.chars > 16_000)) break
			if (Date.now() > deadline) throw new VerifyError(`the agent's transcript has no entry past the bubble: ${JSON.stringify(entries)}`)
			await Bun.sleep(500)
		}
		room.raw.close()
	},
}

export default suite
