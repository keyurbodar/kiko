// One alarm admits at most one run; Cloudflare's bounded retry owns a failed alarm. These drive that
// alarm by hand against real SQLite.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import type { Seed, Snapshot } from "./owner-dispatch-worker"

const ROOM = "01J00000000000000000000000"
const ROOM_B = "01J00000000000000000000001"

type Probes = {
  probeSeed(runs: Seed[], deadlines?: { scope: string; at: number }[]): Promise<void>
  probeConfigure(mode: { fail?: boolean; reenter?: boolean }): Promise<void>
  probeWake(): Promise<{ ok: boolean; error?: string }>
  probeSnapshot(): Promise<Snapshot>
}

let mf: Miniflare
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./owner-dispatch-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { OWNER: { className: "TestOwner", useSQLite: true } },
  })
  await mf.ready
}, 60_000)
afterAll(async () => { await mf?.dispose() })

/** A fresh OwnerDO per test, so the alarm box and the fake agent tally start empty. */
async function owner() {
  const ns = await mf.getDurableObjectNamespace("OWNER")
  const stub = ns.get(ns.newUniqueId()) as unknown as Probes
  return {
    seed: (runs: Seed[], deadlines: { scope: string; at: number }[] = []) => stub.probeSeed(runs, deadlines),
    configure: (mode: { fail?: boolean; reenter?: boolean }) => stub.probeConfigure(mode),
    wake: () => stub.probeWake(),
    snapshot: () => stub.probeSnapshot(),
  }
}

function ticket(agent: string, request: string, readyAt: number, version = 1): Seed {
  const split = agent.indexOf(":")
  return { agent, room: agent.slice(0, split), slug: agent.slice(split + 1), request, readyAt, version }
}

/** Comfortably past the queue's minimum gap between two admissions. */
const GAP_WAIT_MS = 300

/** The queue arms its own next wake; never fire an alarm before it is due. */
async function untilDue(at: number | null): Promise<void> {
  await Bun.sleep(Math.max(GAP_WAIT_MS, (at ?? 0) - Date.now() + 40))
}

test("one alarm admits one ready agent, keeps the other durable, and leaves the next wake a full gap away", async () => {
  const queue = await owner()
  const now = Date.now()
  await queue.seed([ticket(`${ROOM}:ada`, "input-a", now - 20), ticket(`${ROOM_B}:bo`, "input-b", now - 10)])

  expect(await queue.wake()).toEqual({ ok: true })
  const first = await queue.snapshot()
  expect(first.invocations.map((entry) => entry.agent)).toEqual([`${ROOM}:ada`])
  expect(first.invocations[0]?.recovery).toBe(true)
  expect(first.maxActive).toBe(1)
  expect(first.active).toBe(0)
  expect(first.runs.map((run) => [run.agent, run.request_id])).toEqual([[`${ROOM_B}:bo`, "input-b"]])
  expect(first.deadlines).toEqual([])
  const endedAt = first.invocations[0]?.endedAt ?? 0
  expect(endedAt).toBeGreaterThan(0)
  expect(first.alarmAt).toBeGreaterThanOrEqual(endedAt + 250)

  await untilDue(first.alarmAt)
  expect(await queue.wake()).toEqual({ ok: true })
  const second = await queue.snapshot()
  expect(second.invocations.map((entry) => entry.agent)).toEqual([`${ROOM}:ada`, `${ROOM_B}:bo`])
  expect(second.maxActive).toBe(1)
  expect(second.runs).toEqual([])
}, 20_000)

test("a run that admits itself keeps the newer queued version and runs it once the gap passes", async () => {
  const queue = await owner()
  await queue.seed([ticket(`${ROOM}:ada`, "input", Date.now() - 10, 1)])
  await queue.configure({ reenter: true })

  expect(await queue.wake()).toEqual({ ok: true })
  const during = await queue.snapshot()
  expect(during.invocations).toHaveLength(1)
  expect(during.reentries).toBe(1)
  expect(during.maxActive).toBe(1)
  // Finishing version 1 must not delete the version 2 ticket the same run queued.
  expect(during.runs.map((run) => [run.agent, run.request_id, run.version])).toEqual([[`${ROOM}:ada`, "input", 2]])

  await queue.configure({ reenter: false })
  await untilDue(during.alarmAt)
  expect(await queue.wake()).toEqual({ ok: true })
  const after = await queue.snapshot()
  expect(after.invocations.map((entry) => entry.agent)).toEqual([`${ROOM}:ada`, `${ROOM}:ada`])
  expect(after.maxActive).toBe(1)
  expect(after.runs).toEqual([])
}, 20_000)

test("a failed invocation keeps its ticket, does not rearm the physical alarm, and frees the active guard", async () => {
  const queue = await owner()
  await queue.seed([ticket(`${ROOM}:ada`, "input", Date.now() - 10)])
  await queue.configure({ fail: true })

  const failed = await queue.wake()
  expect(failed.ok).toBe(false)
  expect(failed.error).toContain("fake invocation failed")
  const held = await queue.snapshot()
  expect(held.invocations).toHaveLength(1)
  expect(held.active).toBe(0)
  // Cloudflare's bounded retry owns the retry; the queue must not rearm the alarm itself.
  expect(held.alarmSets).toBe(0)
  expect(held.alarmAt).toBeNull()
  expect(held.runs.map((run) => [run.agent, run.request_id, run.version])).toEqual([[`${ROOM}:ada`, "input", 1]])
  expect(held.deadlines.map((deadline) => deadline.scope)).toEqual([`agent:${ROOM}:ada`])

  await queue.configure({ fail: false })
  await untilDue(held.alarmAt)
  expect(await queue.wake()).toEqual({ ok: true })
  const recovered = await queue.snapshot()
  expect(recovered.invocations).toHaveLength(2)
  expect(recovered.maxActive).toBe(1)
  expect(recovered.runs).toEqual([])
}, 20_000)
