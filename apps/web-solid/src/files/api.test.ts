import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createFile, forgetMade, withMade } from "./api"

// A made file stays in the tree until the index has it. A rename or delete must drop it, or the old name lingers.
describe("made files", () => {
	const realFetch = globalThis.fetch

	beforeEach(() => {
		globalThis.fetch = (async (url: string | URL | Request) => {
			const name = decodeURIComponent(String(url).split("path=")[1] ?? "")
			return Response.json({ file: { id: name, name, type: "text/plain", size: 0 } })
		}) as unknown as typeof fetch
	})

	afterEach(() => {
		globalThis.fetch = realFetch
	})

	test("a renamed or deleted file leaves the tree", async () => {
		expect(await createFile("room", "notes.md")).toBe(true)
		expect(withMade("room", []).map((f) => f.name)).toEqual(["notes.md"])
		forgetMade("room", "notes.md")
		expect(withMade("room", []).map((f) => f.name)).toEqual([])
	})

	test("a folder drops the files under it, and no others", async () => {
		await createFile("room", "docs/a.md")
		await createFile("room", "docs2.md")
		forgetMade("room", "docs")
		expect(withMade("room", []).map((f) => f.name)).toEqual(["docs2.md"])
	})

	test("another chat's made file stays", async () => {
		await createFile("other", "notes.md")
		forgetMade("room", "notes.md")
		expect(withMade("other", []).map((f) => f.name)).toEqual(["notes.md"])
	})
})
