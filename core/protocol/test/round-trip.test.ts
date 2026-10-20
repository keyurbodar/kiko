import { describe, expect, test } from "bun:test"
import * as Schema from "effect/Schema"
import * as F from "../src/fixtures"
import * as Frames from "./frames"
import * as S from "../src/schema"

const roundTrip = <T>(schema: Schema.Codec<T, unknown>, frame: T) => {
	const wire = JSON.parse(JSON.stringify(frame)) as unknown
	const decoded = Schema.decodeUnknownSync(schema)(wire)
	expect(decoded).toEqual(frame)
	expect(Schema.encodeUnknownSync(schema)(decoded)).toEqual(wire)
}

const cases = [
	["ClientToRoom", S.ClientToRoom, Frames.clientToRoom],
	["RoomToClient", S.RoomToClient, Frames.roomToClient],
	["RoomEvent", S.RoomEvent, F.roomEvents],
	["RoomSnapshot", S.RoomSnapshot, [F.roomSnapshot]],
	["ClientToUser", S.ClientToUser, Frames.clientToUser],
	["UserToClient", S.UserToClient, Frames.userToClient],
	["Envelope", S.Envelope, Frames.envelopes],
	["RichText", S.RichText, [F.richText]],
	["Activity", S.Activity, F.activities],
	["SystemEvent", S.SystemEvent, F.systemEvents],
] as const

describe("fixture round trip", () => {
	for (const [name, schema, frames] of cases) {
		test(name, () => {
			expect(frames.length).toBeGreaterThan(0)
			for (const frame of frames) roundTrip(schema as Schema.Codec<unknown, unknown>, frame)
		})
	}

	test("the fixtures hold every frame and event tag", () => {
		const tags = (frames: readonly { t: string }[]) => new Set(frames.map((frame) => frame.t))
		expect(tags(Frames.clientToRoom)).toEqual(
			new Set(["hello", "send", "react", "edit", "delete", "read", "typing", "stop", "task", "member", "search", "history", "answer", "skip"]),
		)
		expect(tags(Frames.roomToClient)).toEqual(new Set(["events", "ack", "reset", "typing", "draft", "status", "member_refused", "send_refused", "search", "history"]))
		expect(tags(F.roomEvents)).toEqual(
			new Set([
				"message",
				"edit",
				"delete",
				"react",
				"read",
				"member",
				"member_removed",
				"task",
				"task_removed",
				"file",
				"ask",
				"ask_resolved",
			]),
		)
		expect(tags(Frames.clientToUser)).toEqual(new Set(["hello", "chat", "open", "search", "login.start", "login.answer", "login.cancel"]))
		expect(tags(Frames.userToClient)).toEqual(
			new Set(["events", "reset", "error", "home_refused", "chat_refused", "search", "login.notify", "login.prompt", "login.done", "login.error"]),
		)
	})
})

describe("system events", () => {
	const message = F.roomEvents.find((e) => e.t === "message" && e.event?.kind === "compacted")

	test("an unknown event kind decodes without throwing and keeps only its kind", () => {
		const stored = { ...F.roomSnapshot.messages[0]!, from: { kind: "system", reason: "files" }, event: { kind: "from_a_newer_server", title: "x", count: 3 } }
		const decoded = Schema.decodeUnknownSync(S.Message)(JSON.parse(JSON.stringify(stored)))
		expect(decoded.event).toEqual({ kind: "from_a_newer_server" })
	})

	test("a divider event stays private in the type and on the wire", () => {
		expect(message?.t === "message" && message.event).toEqual({ kind: "compacted", agent: F.ada, private: true })
		const unmarked = { kind: "compacted", agent: F.ada, private: false }
		expect(() => Schema.decodeUnknownSync(S.SystemEvent)(unmarked)).toThrow()
	})

	test("an unknown event kind inside a room event frame decodes", () => {
		const system = F.roomEvents.find((e) => e.t === "message" && e.from.kind === "system")
		const frame = { t: "events", events: [{ ...system, event: { kind: "later" } }] }
		expect(() => Schema.decodeUnknownSync(S.RoomToClient)(JSON.parse(JSON.stringify(frame)))).not.toThrow()
	})
})

describe("the schemas reject bad frames", () => {
	const rejects = (schema: Schema.Codec<unknown, unknown>, value: unknown) =>
		expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow()

	test("an unknown tag", () => rejects(S.ClientToRoom as never, { t: "shout", text: "hi" }))
	test("a slug with capitals", () => rejects(S.AgentSlug as never, "Ada"))
	test("a slug longer than 32", () => rejects(S.AgentSlug as never, "a".repeat(33)))
	test("a room id that is neither a UUIDv7 nor a ULID", () => rejects(S.RoomId as never, "room-1"))
	test("an uppercase UUIDv7, which would name a second object for the same room", () => rejects(S.RoomId as never, "01A0FA46-9777-7FDF-871E-3C63E992C708"))
	test("a negative seq", () => rejects(S.ClientToRoom as never, { t: "hello", lastSeq: -1 }))
	test("a nested bad slug in rich text", () =>
		rejects(S.RichText as never, [{ t: "paragraph", children: [{ t: "bold", children: [{ t: "mention", slug: "NO" }] }] }]))
	test("a heading level of 7", () => rejects(S.RichText as never, [{ t: "heading", level: 7, children: [] }]))
})

describe("the client entry", () => {
	test("a type-only import bundles to no code", async () => {
		const result = await Bun.build({ entrypoints: [`${import.meta.dir}/client-entry.ts`], minify: true })
		expect(result.success).toBe(true)
		const output = await result.outputs[0]!.text()
		expect(output.trim()).toBe("")
	})

	test("importing the slug pattern bundles no Effect code", async () => {
		const result = await Bun.build({ entrypoints: [`${import.meta.dir}/client-pattern.ts`], minify: true })
		expect(result.success).toBe(true)
		const output = await result.outputs[0]!.text()
		expect(output).toContain("[a-z0-9-]{1,32}")
		expect(output.length).toBeLessThan(300)
	})
})

describe("messages stored before the media cleanup", () => {
	test("a message with a link preview and sized files decodes to today's shape", () => {
		const stored = F.roomSnapshot.messages[0]!
		const old = {
			...stored,
			files: [{ ...F.file, width: 1280, height: 720, thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI", thumb: true }],
			preview: { url: "https://example.com/", title: "example" },
		}
		const decoded = Schema.decodeUnknownSync(S.Message)(JSON.parse(JSON.stringify(old)))
		expect(decoded).toEqual({ ...stored, files: [F.file] })
	})

	test("a retired frame tag no longer decodes", () => {
		expect(() => Schema.decodeUnknownSync(S.ClientToRoom)({ t: "catalog", kind: "media" })).toThrow()
	})
})

test("owner socket envelopes preserve every user and room frame", () => {
	for (const frame of Frames.clientToUser) roundTrip(S.ClientToOwner, frame)
	for (const frame of Frames.userToClient) roundTrip(S.OwnerToClient, frame)
	for (const frame of Frames.clientToRoom) roundTrip(S.ClientToOwner, { t: "room", roomId: F.roomId, frame })
	for (const frame of Frames.roomToClient) roundTrip(S.OwnerToClient, { t: "room", roomId: F.roomId, frame })
	roundTrip(S.ClientToOwner, { t: "subscribe", roomId: F.roomId, lastSeq: 12 })
	roundTrip(S.ClientToOwner, { t: "unsubscribe", roomId: F.roomId })
	expect(() => Schema.decodeUnknownSync(S.ClientToOwner)({ t: "subscribe", roomId: F.roomId })).toThrow()
	expect(() => Schema.decodeUnknownSync(S.ClientToOwner)({ t: "room", roomId: F.roomId, frame: { t: "unknown" } })).toThrow()
})
