import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
let origin: string

beforeAll(async () => {
	const script = await bundleWorker(new URL("./workspace-worker.ts", import.meta.url))
	mf = new Miniflare({
		modules: true,
		script,
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: { WS: { className: "WorkspaceDO", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

let n = 0
const room = () => `room-${++n}`
const post = async (path: string, body: unknown) => (await fetch(`${origin}${path}`, { method: "POST", body: JSON.stringify(body) })).json() as Promise<any>
const call = (r: string, slug: string, lead: boolean, c: unknown) => post(`/call/${r}`, { slug, lead, call: c })
const state = async (r: string) => (await fetch(`${origin}/state/${r}`)).json() as Promise<any>

test("only the lead creates tasks, and a task needs known dependencies and members", async () => {
	const r = room()
	expect((await call(r, "ada", false, { op: "create_task", id: "a", title: "x" })).answer).toEqual({ ok: false, error: "only the lead creates tasks" })
	const made = await call(r, "bob", true, { op: "create_task", id: "a", title: "write it", owner: "ada" })
	expect(made.answer.ok).toBe(true)
	expect(made.events.map((e: any) => [e.t, e.task.id, e.task.owner, e.task.status])).toEqual([["task", "a", "ada", "todo"]])
	expect((await call(r, "bob", true, { op: "create_task", id: "b", title: "y", dependsOn: ["zz"] })).answer.error).toBe("no task zz")
	expect((await call(r, "bob", true, { op: "create_task", id: "b", title: "y", owner: "eve" })).answer.error).toBe("@eve is not a member of this room")
	expect((await call(r, "bob", true, { op: "create_task", id: "b", title: "y", dependsOn: ["b"] })).answer.error).toBe("task b cannot depend on itself")
	expect((await call(r, "bob", true, { op: "create_task", id: "a", title: "write it", owner: "ada" })).events).toEqual([])
})

test("taking a task another agent owns fails and names the owner; doing takes a free one", async () => {
	const r = room()
	await call(r, "bob", true, { op: "create_task", id: "a", title: "write it", owner: "ada" })
	const refused = await call(r, "cy", false, { op: "update_task", id: "a", status: "doing" })
	expect(refused.answer.ok).toBe(false)
	expect(refused.answer.error).toContain("owned by @ada")
	expect(refused.events).toEqual([])
	await call(r, "bob", true, { op: "create_task", id: "free", title: "anyone" })
	const claimed = await call(r, "cy", false, { op: "update_task", id: "free", status: "doing" })
	expect(claimed.events.map((e: any) => [e.task.owner, e.task.status])).toEqual([["cy", "doing"]])
})

test("a lead that starts an unowned task owns it, and an agent can assign itself with owner me", async () => {
  const r = room()
  await call(r, "bob", true, { op: "create_task", id: "a", title: "write it" })
  const started = await call(r, "bob", true, { op: "update_task", id: "a", status: "doing" })
  expect(started.answer.ok).toBe(true)
  expect(started.events.map((e: any) => [e.task.owner, e.task.status])).toEqual([["bob", "doing"]])
  expect(started.answer.text).toContain("@bob")

  await call(r, "bob", true, { op: "create_task", id: "b", title: "test it" })
  const mine = await call(r, "ada", false, { op: "update_task", id: "b", status: "doing", owner: "me" })
  expect(mine.events.map((e: any) => [e.task.owner, e.task.status])).toEqual([["ada", "doing"]])
  expect(mine.answer.text).toContain("@ada")
})

test("a task taken for someone else follows the claim rules, and a refused change is an error", async () => {
  const r = room()
  await call(r, "bob", true, { op: "create_task", id: "a", title: "write it" })
  const given = await call(r, "bob", true, { op: "update_task", id: "a", owner: "@cy" })
  expect(given.events.map((e: any) => [e.task.owner, e.task.status])).toEqual([["cy", "doing"]])

  // Reassigning someone else's task is a lead's act, and it does not restart work that has begun.
  const moved = await call(r, "bob", true, { op: "update_task", id: "a", owner: "ada" })
  expect(moved.events.map((e: any) => [e.task.owner, e.task.status])).toEqual([["ada", "doing"]])

  const stranger = await call(r, "cy", false, { op: "update_task", id: "a", status: "doing" })
  expect(stranger.answer).toEqual({ ok: false, error: "task a is owned by @ada" })
  expect(stranger.events).toEqual([])
  const grab = await call(r, "cy", false, { op: "update_task", id: "a", status: "review" })
  expect(grab.answer).toEqual({ ok: false, error: "task a is owned by @ada" })

  // Taking a closed task is refused, and the refusal leaves the task as it was.
  await call(r, "bob", true, { op: "create_task", id: "closed", title: "old", owner: "cy" })
  await call(r, "cy", false, { op: "update_task", id: "closed", status: "done" })
  const reopen = await call(r, "bob", true, { op: "update_task", id: "closed", status: "doing", owner: "ada" })
  expect(reopen.answer).toEqual({ ok: false, error: "task closed is done" })
  expect(reopen.events).toEqual([])
  expect((await state(r)).tasks.find((t: any) => t.id === "closed")).toMatchObject({ status: "done", owner: "cy" })

  // An owner who is not in the room is refused, and so is a task someone else owns.
  const nobody = await call(r, "bob", true, { op: "update_task", id: "a", owner: "eve" })
  expect(nobody.answer).toEqual({ ok: false, error: "@eve is not a member of this room" })
  expect(nobody.events).toEqual([])
})

test("a task waiting on another is taken without starting, as a claim does", async () => {
  const r = room()
  await call(r, "bob", true, { op: "create_task", id: "first", title: "first" })
  await call(r, "bob", true, { op: "create_task", id: "second", title: "second", dependsOn: ["first"] })
  const held = await call(r, "ada", false, { op: "update_task", id: "second", owner: "me" })
  expect(held.events.map((e: any) => [e.task.owner, e.task.status])).toEqual([["ada", "todo"]])
})

test("the status set is enforced, and an agent changes only its own tasks", async () => {
	const r = room()
	await call(r, "bob", true, { op: "create_task", id: "a", title: "write it", owner: "ada" })
	expect((await call(r, "ada", false, { op: "update_task", id: "a", status: "finished" })).answer.error).toContain("status must be one of")
	expect((await call(r, "cy", false, { op: "update_task", id: "a", status: "doing" })).answer.error).toBe("task a is owned by @ada")
	expect((await call(r, "ada", false, { op: "update_task", id: "a", status: "review", note: "ready" })).events[0].task).toEqual({
		id: "a",
		title: "write it",
		status: "review",
		owner: "ada",
		dependsOn: [],
		note: "ready",
	})
	expect((await call(r, "bob", true, { op: "update_task", id: "a", status: "doing" })).answer.ok).toBe(true)
})

test("a dependency cycle is rejected", async () => {
	const r = room()
	await post(`/human/${r}`, { create: true, id: "a", title: "a" })
	await post(`/human/${r}`, { create: true, id: "b", title: "b", dependsOn: ["a"] })
	expect((await post(`/human/${r}`, { create: true, id: "c", title: "c", dependsOn: ["b", "a"] })).ok).toBe(true)
	expect((await post(`/human/${r}`, { create: true, id: "c", title: "other", dependsOn: ["c"] })).ok).toBe(false)
	expect((await state(r)).tasks.map((t: any) => [t.id, t.dependsOn])).toEqual([
		["a", []],
		["b", ["a"]],
		["c", ["b", "a"]],
	])
})

test("finishing the last dependency unblocks a task once, and a task cannot finish before its dependencies", async () => {
	const r = room()
	await call(r, "bob", true, { op: "create_task", id: "a", title: "first", owner: "ada" })
	await post(`/woke/${r}`, { taskId: "a" })
	await call(r, "bob", true, { op: "create_task", id: "a2", title: "also first", owner: "bob" })
	await call(r, "bob", true, { op: "create_task", id: "b", title: "second", owner: "cy", dependsOn: ["a", "a2"] })
	expect((await call(r, "cy", false, { op: "update_task", id: "b", status: "done" })).answer.error).toBe("task b waits on a, a2, which are not done")
	expect((await state(r)).brief.map((t: any) => t.id)).toEqual(["b", "a", "a2"])
	expect((await call(r, "ada", false, { op: "update_task", id: "a", status: "done" })).wakes).toEqual([])
	const done = await call(r, "bob", true, { op: "update_task", id: "a2", status: "done" })
	expect(done.wakes).toEqual([{ taskId: "b", owner: "cy", title: "second", seq: done.events[0].seq, chain: { rootId: "m-bob", hop: 1 } }])
	expect(await post(`/woke/${r}`, { taskId: "b" })).toEqual([])
	await call(r, "bob", true, { op: "update_task", id: "a2", status: "review" })
	expect((await call(r, "bob", true, { op: "update_task", id: "a2", status: "done" })).wakes).toEqual([])
})


test("a ready assignment wakes its owner without a separate message", async () => {
  const r = room()
  const made = await call(r, "bob", true, { op: "create_task", id: "ready", title: "Check senders", owner: "ada" })
  expect(made.wakes).toHaveLength(1)
  expect(made.wakes[0]).toMatchObject({ taskId: "ready", owner: "ada" })
  await post(`/woke/${r}`, { taskId: "ready" })
  expect((await call(r, "bob", true, { op: "create_task", id: "ready", title: "Check senders", owner: "ada" })).wakes).toEqual([])
})

test("agent task titles stay below twelve words without silently clipping instructions", async () => {
	const r = room()
	const eleven = "one two three four five six seven eight nine ten eleven"
	const twelve = `${eleven} twelve`
	const refused = await call(r, "bob", true, { op: "create_task", id: "long", title: twelve })
	expect(refused.answer.ok).toBe(false)
	expect(refused.events).toEqual([])
	expect((await state(r)).tasks).toEqual([])
	expect((await call(r, "bob", true, { op: "create_task", id: "short", title: eleven, owner: "ada" })).answer.ok).toBe(true)
	const renamed = await call(r, "ada", false, { op: "update_task", id: "short", title: twelve, status: "done" })
	expect(renamed.answer.ok).toBe(false)
	expect((await state(r)).tasks[0].title).toBe(eleven)
	expect((await state(r)).tasks[0].status).toBe("todo")
	expect((await call(r, "ada", false, { op: "update_task", id: "short", status: "doing" })).answer.ok).toBe(true)
})
