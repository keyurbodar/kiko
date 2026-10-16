import { afterAll, beforeAll, expect, test } from "bun:test"
import type { Message, RoomSnapshot, RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./groups-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		r2Buckets: ["FILES"],
		bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
		durableObjects: { ROOM: { className: "RoomDO", useSQLite: true }, USER: { className: "UserDO", useSQLite: true }, AGENT: { className: "AgentDO", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

let n = 0
const fresh = () => `01JZ8Q4T6M${String(++n + 100).padStart(16, "0")}`

async function open(room: string) {
	const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
	const frames: RoomToClient[] = []
	ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
	await new Promise((resolve, reject) => {
		ws.onopen = resolve
		ws.onerror = reject
	})
	const take = async (match: (f: RoomToClient) => boolean) => {
		for (let i = 0; i < 3000; i++) {
			const at = frames.findIndex(match)
			if (at >= 0) return frames.splice(at, 1)[0]!
			await Bun.sleep(2)
		}
		throw new Error(`no frame. have ${JSON.stringify(frames)}`)
	}
	ws.send(JSON.stringify({ t: "hello", lastSeq: 1_000_000 }))
	return { take, send: (frame: unknown) => ws.send(JSON.stringify(frame)), close: () => ws.close() }
}

async function snapshot(room: string): Promise<RoomSnapshot> {
	const c = await open(room)
	const reset = await c.take((f) => f.t === "reset")
	c.close()
	if (reset.t !== "reset") throw new Error("no snapshot")
	return reset.snapshot
}

const rpc = async (room: string, method: string, ...args: unknown[]) => {
	const res = await fetch(`${origin}/rpc/${room}/${method}`, { method: "POST", body: JSON.stringify(args) })
	return res.json() as Promise<any>
}
const seen = async (room: string, slug: string) => (await (await fetch(`${origin}/agent/${room}/${slug}`)).json()) as { got: { body: string; from: { slug: string }; hop: number }[]; stops: number }
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean) => {
	let v = await read()
	for (let i = 0; i < 500 && !ok(v); i++) {
		await Bun.sleep(10)
		v = await read()
	}
	return v
}
const members = async (room: string) => (await snapshot(room)).members.map((m) => m.slug).sort()
const opened = async () => (await (await fetch(`${origin}/opened/x/x`)).json()) as { title: string; agents: string[] }[]

/** A room that already has Kiko and Ada in it, with its human socket connected. */
async function roomWith(...slugs: string[]) {
	const room = fresh()
	for (const slug of slugs) expect(await rpc(room, "memberOp", { op: "add", slug, name: slug })).toBeNull()
	const c = await open(room)
	await c.take((f) => f.t === "reset")
	return { room, c }
}

const receipt = async (room: string) => (await snapshot(room)).messages.find((m: Message) => m.goto)?.goto as string

test("the Kiko chat refuses any member add, from the socket and from an agent", async () => {
	const room = fresh()
	await fetch(`${origin}/kiko/${room}/x`)
	const c = await open(room)
	await c.take((f) => f.t === "reset")
	expect(await rpc(room, "memberOp", { op: "add", slug: "ada", name: "Ada" })).toBe("kiko")
	c.send({ t: "member", op: { op: "add", slug: "bo", name: "Bo" } })
	expect(await c.take((f) => f.t === "member_refused")).toMatchObject({ reason: "kiko" })
	expect(await members(room)).toEqual(["kiko"])
	c.close()
})

test("a Kiko chat that already holds other members drops them once, and stops their agents", async () => {
	const room = fresh()
	for (const slug of ["kiko", "ada", "bo"]) expect(await rpc(room, "memberOp", { op: "add", slug, name: slug })).toBeNull()
	await fetch(`${origin}/kiko/${room}/x`)
	const c = await open(room)
	await c.take((f) => f.t === "reset")
	expect(await members(room)).toEqual(["kiko"])
	const stops = await until(async () => (await seen(room, "ada")).stops + (await seen(room, "bo")).stops, (v) => v >= 2)
	expect(stops).toBe(2)
	await open(room).then((x) => x.close())
	expect(await members(room)).toEqual(["kiko"])
	// The chat record follows, so the pinned tile shows Kiko alone.
	expect(await until(async () => (await fetch(`${origin}/saved/${room}/x`)).json(), (v) => JSON.stringify(v) === '["kiko"]')).toEqual(["kiko"])
	c.close()
})

test("an agent that is not Kiko makes a group that has Kiko in it, and its kickoff reaches every other member", async () => {
	const { room, c } = await roomWith("kiko", "ada")
	const out = await rpc(room, "createGroup", "ada", { title: "Trip", members: ["bo"], newAgents: [], goal: "plan a trip", kickoff: "find flights for june" })
	expect(out).toMatchObject({ ok: true })
	const group = await receipt(room)
	expect(await members(group)).toEqual(["ada", "bo", "kiko"])
	const bo = await until(() => seen(group, "bo"), (v) => v.got.length > 0)
	expect(bo.got[0]).toMatchObject({ body: "find flights for june", from: { slug: "ada" } })
	expect((await seen(group, "kiko")).got.map((e) => e.body)).toEqual(["find flights for june"])
	expect((await seen(group, "ada")).got).toEqual([])
	const snap = await snapshot(group)
	expect(snap.messages.some((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.includes("find flights for june"))).toBe(true)
	expect(snap.files.map((f) => f.name)).toContain("chat.md")
	c.close()
})

test("asking again for the same agents reuses the chat and still sends the new kickoff", async () => {
	const { room, c } = await roomWith("kiko", "ada")
	await rpc(room, "createGroup", "ada", { title: "Plan", members: ["di"], newAgents: [], goal: "g", kickoff: "first" })
	const group = await receipt(room)
	const again = await rpc(room, "createGroup", "ada", { title: "Plan", members: ["di"], newAgents: [], goal: "g", kickoff: "second" })
	expect(again).toMatchObject({ ok: true, text: expect.stringContaining("already") })
	const bo = await until(() => seen(group, "di"), (v) => v.got.length >= 2)
	expect(bo.got.map((e) => e.body)).toEqual(["first", "second"])
	expect((await opened()).filter((o) => o.title === "Plan")).toHaveLength(1)
	c.close()
})

test("only Kiko makes agents: another agent that tries is refused, and Kiko can put new agents in a group", async () => {
	const { room, c } = await roomWith("kiko", "ada")
	const soul = { name: "Cy", handle: "cy", description: "reads", soul: "# Cy\nI read." }
	expect(await rpc(room, "createAgent", "ada", soul)).toMatchObject({ ok: false, error: expect.stringContaining("only kiko") })
	expect(await rpc(room, "createGroup", "ada", { title: "G", members: ["bo"], newAgents: [soul], goal: "", kickoff: "go" })).toMatchObject({ ok: false, error: expect.stringContaining("only kiko") })
	expect(await rpc(room, "createGroup", "kiko", { title: "G2", members: ["bo"], newAgents: [soul], goal: "", kickoff: "go" })).toMatchObject({ ok: true })
	expect(await members(await receipt(room))).toEqual(["bo", "cy", "kiko"])
	c.close()
})
