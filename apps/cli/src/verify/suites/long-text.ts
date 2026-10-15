import { newRoom, poll, seen } from "../kit"
import type { RoomEvent } from "@kiko/protocol"
import { expectEqual, type Session, VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake } from "./mid-run"

// A human message past the bubble limit: the room shows the first 16,000 characters and stores the
// whole text as a file. The file's bytes come back whole, and the agent's transcript takes the message.

// A mention past the bubble limit still routes. The message names @ada after character 16,000, so ada
// answers and the lead does not.
async function mentionPastBubble(v: { url: string }, alice: Session): Promise<void> {
	const { roomId, room } = await newRoom(alice, "long mention")
	await fake(v, alice, roomId, ["kiko", "ada"])
	room.raw.send({ t: "member", op: { op: "add", slug: "ada" as never, name: "Ada" } })
	await room.expect((f) => f.t === "events" && f.events.some((e) => e.t === "member" && e.member.slug === "ada"), 10_000)
	// The bubble is the first 16,000 characters and holds a short scripted reply, so ada's answer is quick. The mention is after it.
	const bubble = `${"0123456789".repeat(1_598)} [reply] got it`.padEnd(16_000)
	const text = `${bubble} @ada ${"0123456789".repeat(398)}`
	if (text.length <= 16_000 || text.indexOf("@ada") < 16_000) throw new VerifyError("the mention must sit past the bubble limit")
	const clientId = crypto.randomUUID()
	room.raw.send({ t: "send", clientId, text })
	const ack = await room.expect((f) => (f.t === "ack" || f.t === "send_refused") && f.clientId === clientId, 10_000)
	if (ack.t !== "ack") throw new VerifyError(`the send was refused: ${ack.t === "send_refused" ? ack.reason : ""}`)
	await poll("ada's answer", () => seen(room).all.some((m) => m.from.kind === "agent" && m.from.slug === "ada"), 20_000)
	await Bun.sleep(2_000)
	expectEqual(
		// The reply's text is "got it" and the attached line the envelope adds after it.
		seen(room).all.map((m) => [m.from.kind === "agent" ? m.from.slug : m.from.kind, m.text.slice(0, 6)]),
		[["ada", "got it"]],
		"the agents' answers: only ada answers",
	)
	room.raw.close()
}

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
		const base = v.url
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
		await mentionPastBubble(v, alice)
	},
}

export default suite
