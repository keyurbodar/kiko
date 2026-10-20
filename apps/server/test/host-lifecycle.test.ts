import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./host-lifecycle-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { T: { className: "T", useSQLite: true } },
  })
  await mf.ready
}, 60_000)
afterAll(async () => { await mf?.dispose() })

type State = {
  recoveryChanges: string[]
  futureTimes?: number[]; waited: number
  epoch: number; journalRows: number; compactions: number; carriedOutput: number
  filled?: { rows: number; bytes: number; epoch: number }
  instance: string; alarmEntries: number; toolCalls: number; finished: boolean; reply?: string
  alarmAt: number | null; errors: string[]; stopped: boolean; wakeups: { key: string; at: number }[]
  crash?: { instance: string; alarmAt: number; at: number; wakeups: { key: string; at: number }[] }
}
async function agent() {
  const ns = await mf.getDurableObjectNamespace("T")
  const id = ns.newUniqueId()
  return async <R = State>(op: string): Promise<R> => await (await ns.get(id).fetch(`http://do/${op}`)).json() as R
}
async function until(read: () => Promise<State>, done: (s: State) => boolean): Promise<State> {
  const deadline = Date.now() + 3_000
  for (;;) {
    const state = await read()
    if (done(state)) return state
    if (Date.now() > deadline) throw new Error(`timed out: ${JSON.stringify(state)}`)
    await Bun.sleep(20)
  }
}

test("a setup failure after a stop clears the stop marker and reports once", async () => {
  const call = await agent()
  await call("stop")
  const failed = await until(() => call("status"), (s) => s.errors.length === 1)
  expect(failed.alarmAt).toBeNull()
  expect(failed.wakeups).toEqual([])
  expect(failed.stopped).toBe(false)
  await call("alarm")
  expect(await call<boolean>("wake")).toBe(false)
  expect(await call("status")).toMatchObject({ errors: failed.errors, stopped: false, alarmAt: null, wakeups: [] })
})


test("a finished run leaves no recovery alarm", async () => {
  const call = await agent()
  await call("normal")
  const finished = await until(() => call("status"), (s) => s.finished && s.alarmAt === null)
  expect(finished.errors).toEqual([])
  expect(finished.wakeups).toEqual([])
  expect(finished.reply).toBe("Finished.")
  expect(finished.recoveryChanges).toEqual(["INSERT", "DELETE"])
})

test("an always-failing model persists one error and leaves no alarm", async () => {
  const call = await agent()
  await call("fail")
  const failed = await until(() => call("status"), (s) => s.errors.length === 1 && s.alarmAt === null)
  expect(failed.wakeups).toEqual([])
  await call("alarm")
  expect(await call("status")).toMatchObject({ errors: failed.errors, alarmAt: null, wakeups: [] })
})

test("a failed harness aborts its Durable Object", async () => {
  const call = await agent()
  const crashed = await call("storage-failure").then(String, (error: unknown) => String(error))
  expect(crashed).toContain("Harness failed")
})

test("erasing an agent closes its retained harness and clears journal recovery", async () => {
  const call = await agent()
  const created = await call("deadlines")
  const pending = await until(() => call("status"), (s) => s.wakeups.some((w) => w.key === "recovery"))
  expect(pending.journalRows).toBeGreaterThan(0)
  expect(pending.alarmAt).toBe(created.futureTimes![0]!)
  expect(await call<{ commitRejected: boolean }>("erase-retained")).toEqual({ commitRejected: true })
  expect(await call("status")).toMatchObject({ journalRows: 0, wakeups: [], alarmAt: null, stopped: false })
})

test("a persisted recovery alarm resumes a literal mid-tool abort without a human event", async () => {
  const call = await agent()
  const crashed = await call("crash").then(String, (error: unknown) => String(error))
  expect(crashed).toContain("host lifecycle eviction during tool")
  // No request wakes the object between the eviction and its real 60-second alarm.
  await Bun.sleep(61_000)
  const finished = await until(() => call("status"), (s) => s.finished && s.alarmAt === null)
  expect(finished.crash).toBeDefined()
  expect(finished.crash!.alarmAt).toBeGreaterThan(finished.crash!.at)
  expect(finished.crash!.alarmAt).toBeLessThanOrEqual(finished.crash!.at + 60_000)
  expect(finished.crash!.wakeups).toContainEqual({ key: "recovery", at: finished.crash!.alarmAt })
  expect(finished.instance).not.toBe(finished.crash!.instance)
  expect(finished.alarmEntries).toBeGreaterThan(0)
  expect(finished.toolCalls).toBe(2)
  expect(finished.errors).toEqual([])
  expect(finished.wakeups).toEqual([])
  expect(finished.reply).toBe("Finished.")
}, 90_000)


for (const mode of ["rows", "bytes"]) {
  test(`an idle journal over the ${mode} limit compacts once and the next input works`, async () => {
    const call = await agent()
    await call(`compact-${mode}`)
    const compacted = await until(() => call("status"), (s) => s.finished && s.epoch === 1 && s.alarmAt === null)
    expect(compacted.compactions).toBe(1)
    expect(compacted.journalRows).toBe(0)
    expect(compacted.carriedOutput).toBeGreaterThan(0)
    expect(compacted.filled!.epoch).toBe(0)
    if (mode === "rows") expect(compacted.filled!.rows).toBeGreaterThan(500)
    else {
      expect(compacted.filled!.rows).toBeLessThan(500)
      expect(compacted.filled!.bytes).toBeGreaterThan(4 * 1024 * 1024)
    }
    await call("normal")
    const next = await until(() => call("status"), (s) => s.finished && s.alarmAt === null)
    expect(next.reply).toBe("Finished.")
    expect(next.errors).toEqual([])
    expect(next.epoch).toBe(1)
    expect(next.compactions).toBe(1)
    expect(next.carriedOutput).toBe(compacted.carriedOutput)
    expect(next.journalRows).toBeGreaterThan(0)
  })
}


test("recovery follows the remaining future task and preserves unrelated wakeups while skipping blocked tasks", async () => {
  const call = await agent()
  const created = await call("deadlines")
  const times = created.futureTimes!
  const first = await until(() => call("status"), (s) => s.wakeups.some((w) => w.key === "recovery" && w.at === times[0]))
  expect(first.alarmAt).toBe(times[0]!)
  expect(first.waited).toBe(0)
  await call("settle-first")
  const second = await until(() => call("status"), (s) => s.wakeups.some((w) => w.key === "recovery" && w.at === times[1]))
  expect(second.alarmAt).toBe(times[1]!)
  await call("settle-second")
  const blocked = await until(() => call("status"), (s) => !s.wakeups.some((w) => w.key === "recovery"))
  expect(blocked.wakeups).toEqual([{ key: "browser-idle", at: times[1]! + 60_000 }])
  expect(blocked.alarmAt).toBe(times[1]! + 60_000)
})
