import { describe, expect, test } from "bun:test"
import * as Schema from "effect/Schema"
import * as F from "../src/fixtures"
import * as S from "../src/schema"

// A frame survives JSON, decodes with its schema, and encodes back unchanged.
const roundTrip = <T>(schema: Schema.Codec<T, unknown>, frame: T) => {
	const wire = JSON.parse(JSON.stringify(frame)) as unknown
	const decoded = Schema.decodeUnknownSync(schema)(wire)
	expect(decoded).toEqual(frame)
	expect(Schema.encodeUnknownSync(schema)(decoded)).toEqual(wire)
}

const cases = [
	["ClientToRoom", S.ClientToRoom, F.clientToRoom],
	["RoomToClient", S.RoomToClient, F.roomToClient],
	["RoomEvent", S.RoomEvent, F.roomEvents],
	["RoomSnapshot", S.RoomSnapshot, [F.roomSnapshot]],
	["ClientToUser", S.ClientToUser, F.clientToUser],
	["UserToClient", S.UserToClient, F.userToClient],
	["Envelope", S.Envelope, F.envelopes],
	["RichText", S.RichText, [F.richText]],
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
		expect(tags(F.clientToRoom)).toEqual(
			new Set(["hello", "send", "react", "edit", "delete", "read", "typing", "stop", "approve", "task", "member", "search", "catalog"]),
		)
		expect(tags(F.roomToClient)).toEqual(new Set(["events", "ack", "reset", "typing", "draft", "status", "member_refused", "search", "catalog"]))
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
				"approval",
				"file",
			]),
		)
		expect(tags(F.clientToUser)).toEqual(new Set(["hello", "chat", "search", "login.start", "login.answer", "login.cancel"]))
		expect(tags(F.userToClient)).toEqual(
			new Set(["events", "reset", "search", "login.notify", "login.prompt", "login.done", "login.error"]),
		)
	})
})

describe("the schemas reject bad frames", () => {
	const rejects = (schema: Schema.Codec<unknown, unknown>, value: unknown) =>
		expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow()

	test("an unknown tag", () => rejects(S.ClientToRoom as never, { t: "shout", text: "hi" }))
	test("a slug with capitals", () => rejects(S.AgentSlug as never, "Ada"))
	test("a slug longer than 32", () => rejects(S.AgentSlug as never, "a".repeat(33)))
	test("a room id that is not a ULID", () => rejects(S.RoomId as never, "room-1"))
	test("a negative seq", () => rejects(S.ClientToRoom as never, { t: "hello", lastSeq: -1 }))
	test("a nested bad slug in rich text", () =>
		rejects(S.RichText as never, [{ t: "paragraph", children: [{ t: "bold", children: [{ t: "mention", slug: "NO" }] }] }]))
	test("a heading level of 7", () => rejects(S.RichText as never, [{ t: "heading", level: 7, children: [] }]))
})

describe("the client entry", () => {
	// A client imports types and maybe the slug pattern. Neither may pull in Effect.
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
