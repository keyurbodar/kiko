import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./host-extensions-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: { T: { className: "T", useSQLite: true } },
	})
	await mf.ready
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

test("an agent made before the Kernel key was added gets browser_link once the host opens with the browser on", async () => {
	const ns = await mf.getDurableObjectNamespace("T")
	const stub = ns.get(ns.newUniqueId())
	const call = async <R>(body: unknown): Promise<R> => (await (await stub.fetch("http://do/", { method: "POST", body: JSON.stringify(body) })).json()) as R

	await call({ op: "browser", on: false })
	const before = await call<string[]>({ op: "turn", n: 1 })
	expect(before.length).toBeGreaterThan(0)
	expect(before).not.toContain("browser_link")

	await call({ op: "browser", on: true })
	await call({ op: "reopen" })
	const after = await call<string[]>({ op: "turn", n: 2 })
	expect(after).toContain("browser_link")
	expect(after).toContain("browser_status")
}, 120_000)
