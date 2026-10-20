import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// `ensureHome` runs on every request a signed-in client makes (`/api/me`, and every auth response). It stores the
// Kiko chat's room id each time. A store of the value a row already holds still costs a row, and the free plan
// counts rows written, so the second and every later call must cost nothing. This is the write that spent 45,224
// rows of one account's day.
let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./do-hygiene-worker.ts", import.meta.url)),
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

type Cost = { read: number; written: number }
const counts = async () => (await (await fetch(`${origin}/user/counts`)).json()) as Cost

async function measure(act: () => Promise<unknown>): Promise<Cost> {
	await Bun.sleep(200)
	const before = await counts()
	await act()
	await Bun.sleep(300)
	const after = await counts()
	return { read: after.read - before.read, written: after.written - before.written }
}

test("the second ensureHome and every one after it write nothing", async () => {
	// The first call builds the Kiko chat, so it writes. That is the only call allowed to.
	const first = await measure(() => fetch(`${origin}/user/home`))
	expect(first.written).toBeGreaterThan(0)

	const second = await measure(() => fetch(`${origin}/user/home`))
	const third = await measure(() => fetch(`${origin}/user/home`))
	const tenth = await measure(async () => {
		for (let i = 0; i < 8; i++) await fetch(`${origin}/user/home`)
	})
	console.log(`ROW ensureHome written: first=${first.written} second=${second.written} third=${third.written} next-8=${tenth.written}`)
	expect(second.written).toBe(0)
	expect(third.written).toBe(0)
	expect(tenth.written).toBe(0)
})
