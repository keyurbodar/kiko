import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// The burst window stores its start as a pending row's at. seq is the order a row was sent in and is staged with
// its message, so the lowest seq holds the window's first at. Reading it that way lets pending_at go, which cost a
// row on every staged human message.
let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./room-reads-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
		durableObjects: { OWNER: { className: "MeteredOwner", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

test("pending has no at index, and the window start still reads one row", async () => {
	const res = await fetch(`${origin}/plan/${"01JZ9PENDIDX00000000000001"}`)
	const body = (await res.json()) as { indexes: string[]; start: string[] }
	console.log(`ROW pending indexes: ${body.indexes.join(", ")}`)
	console.log(`ROW window start plan: ${body.start.join(" | ")}`)
	expect(body.indexes).not.toContain("pending_at")
	expect(body.indexes).toContain("pending_seq")
	expect(body.start.join(" ")).toContain("pending_seq")
})
