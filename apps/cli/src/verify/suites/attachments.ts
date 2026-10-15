import { newRoomId } from "@kiko/protocol"
import type { PendingAttachment, RoomEvent, RoomToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"



const MiB = 1024 * 1024
const PART = 16 * MiB

const suite: Suite = {
	name: "attachments",
	async run(v) {
		const alice = await v.as("attachments-alice")
		const bob = await v.as("attachments-bob")
		const roomId = newRoomId()
		const base = new URL(`api/files/${roomId}/`, v.url)
		const call = (path: string, init: RequestInit & { as?: typeof alice } = {}) =>
			fetch(new URL(path, base), { ...init, headers: { authorization: (init.as ?? alice).auth, ...(init.headers as Record<string, string>) } })
		const errorOf = async (res: Response) => ((await res.json()) as { error?: string }).error
		const upload = (id: string, body: Uint8Array<ArrayBuffer>, name: string, type: string, size = body.length) =>
			call(`pending/${id}?${new URLSearchParams({ name, size: String(size) })}`, { method: "PUT", headers: { "content-type": type }, body })

		const room = await alice.room(roomId)
		await room.expect({ t: "events" })
		const send = (clientId: string, attachments: PendingAttachment[], text = "") => room.raw.send({ t: "send", clientId, text, attachments })
		const answer = (clientId: string) => room.expect((f) => (f.t === "ack" || f.t === "send_refused") && f.clientId === clientId, 10_000)
		const hasFile = (id: string) => (f: RoomToClient) => f.t === "events" && f.events.some((e) => e.t === "file" && e.file.id === id)

		const pdf = new TextEncoder().encode("%PDF-1.4 a small plan")
		const pdfId = crypto.randomUUID()
		const put = await upload(pdfId, pdf, "plan.pdf", "application/pdf")
		expectEqual(put.status, 204, "the pending upload's status")
		await room.expectNone(hasFile(pdfId), 500)
		const stranger = await call(`pending/${pdfId}`, { method: "DELETE", as: bob })
		expectEqual(stranger.status, 404, "another user's delete")
		await stranger.body?.cancel()

		const lie = await upload(crypto.randomUUID(), pdf, "plan.pdf", "application/pdf", pdf.length + 5)
		expectEqual(lie.status, 400, "a lying length's status")
		expectEqual(await errorOf(lie), "Content-Length must match the upload size.", "a lying length's reason")

		const big = await upload(crypto.randomUUID(), new Uint8Array(10 * MiB + 1), "huge.png", "image/png")
		expectEqual(big.status, 413, "an oversized picture's status")
		expectEqual(await errorOf(big), "'huge.png' exceeds the 10 MB attachment limit.", "an oversized picture's reason")

		const goneId = crypto.randomUUID()
		expectEqual((await upload(goneId, new TextEncoder().encode("bye"), "gone.txt", "text/plain")).status, 204, "the doomed upload")
		expectEqual((await call(`pending/${goneId}`, { method: "DELETE" })).status, 204, "the delete")
		send("gone", [{ pendingId: goneId, name: "gone.txt", type: "text/plain", size: 3 }], "with a removed file")
		const refused = await answer("gone")
		if (refused.t !== "send_refused") throw new VerifyError("a send naming a deleted upload was stored")
		expectEqual(refused.reason, "Attachment 'gone.txt' cannot be sent: attachment not found (removed or expired).", "the refusal")

		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
		const pngId = crypto.randomUUID()
		expectEqual((await upload(pngId, png, "shot.png", "image/png")).status, 204, "the picture upload")
		const attachments: PendingAttachment[] = [
			{ pendingId: pngId, name: "shot.png", type: "image/png", size: png.length },
			{ pendingId: pdfId, name: "plan.pdf", type: "application/pdf", size: pdf.length },
		]
		send("claim", attachments, "here they are")
		const ack = await answer("claim")
		if (ack.t !== "ack") throw new VerifyError(`the send was refused: ${ack.t === "send_refused" ? ack.reason : ""}`)
		const stored = await room.expect((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.clientId === "claim"), 10_000)
		const message = stored.t === "events" ? stored.events.find((e): e is Extract<RoomEvent, { t: "message" }> => e.t === "message") : undefined
		expectEqual(message?.files?.map((f) => [f.id, f.type, f.size]), [[pngId, "image/png", png.length], [pdfId, "application/pdf", pdf.length]], "the message's files")
		for (const f of message?.files ?? []) {
			if (!/^attachments\/[0-9a-z]+-(shot\.png|plan\.pdf)$/.test(f.name)) throw new VerifyError(`a claimed file is at ${f.name}`)
		}
		const download = await call(pdfId)
		expectEqual(new TextDecoder().decode(await download.arrayBuffer()), "%PDF-1.4 a small plan", "the claimed file's bytes")

		const other = await alice.room(roomId)
		const hello = await other.expect((f) => f.t === "events" || f.t === "reset")
		const indexed = hello.t === "reset" ? hello.snapshot.files.map((f) => f.id) : hello.t === "events" ? hello.events.flatMap((e) => (e.t === "file" ? [e.file.id] : [])) : []
		if (!indexed.includes(pngId) || !indexed.includes(pdfId)) throw new VerifyError(`the room's files do not hold the claimed attachments: ${JSON.stringify(indexed)}`)

		send("claim", attachments, "here they are")
		const again = await answer("claim")
		expectEqual(again, ack, "the resent send's answer")
		await room.expectNone((f) => f.t === "events" && f.events.some((e) => e.t === "message" || e.t === "file"), 500)

		const huge = new Uint8Array(40 * MiB)
		crypto.getRandomValues(huge.subarray(0, 65_536))
		const hugeId = crypto.randomUUID()
		const created = await call(`pending/${hugeId}/parts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "data.bin", type: "application/octet-stream", size: huge.length }),
		})
		if (!created.ok) throw new VerifyError(`starting the multipart upload answered ${created.status}: ${await created.text()}`)
		const { uploadId } = (await created.json()) as { uploadId: string }
		const parts: unknown[] = []
		for (let from = 0, n = 1; from < huge.length; from += PART, n++) {
			const res = await call(`pending/${hugeId}/parts/${n}?uploadId=${encodeURIComponent(uploadId)}`, { method: "PUT", body: huge.slice(from, from + PART) })
			if (!res.ok) throw new VerifyError(`part ${n} answered ${res.status}`)
			parts.push(await res.json())
		}
		const done = await call(`pending/${hugeId}/complete?uploadId=${encodeURIComponent(uploadId)}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ parts }),
		})
		expectEqual(done.status, 204, "the multipart completion")
		send("parts", [{ pendingId: hugeId, name: "data.bin", type: "application/octet-stream", size: huge.length }])
		expectEqual((await answer("parts")).t, "ack", "the big file's send")
		await room.expect(hasFile(hugeId), 10_000)

		const staleId = crypto.randomUUID()
		expectEqual((await upload(staleId, new TextEncoder().encode("old"), "old.txt", "text/plain")).status, 204, "the stale upload")
		const aged = await fetch(new URL("api/dev/agent/pending", v.url), {
			method: "POST",
			headers: { authorization: alice.auth, "content-type": "application/json" },
			body: JSON.stringify({ roomId, ms: 25 * 3_600_000 }),
		})
		if (!aged.ok) throw new VerifyError(`the dev sweep answered ${aged.status}. start the Worker with NODE_ENV=development`)
		expectEqual(((await aged.json()) as { pending: number }).pending, 0, "pending uploads after the sweep")
		const swept = await call(staleId)
		expectEqual(swept.status, 404, "the swept upload's bytes")
		await swept.body?.cancel()
		expectEqual((await call(pngId)).status, 200, "a sent file after the sweep")
		other.raw.close()
	},
}

export default suite
