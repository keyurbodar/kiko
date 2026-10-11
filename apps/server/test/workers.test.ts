import { afterAll, beforeAll, expect, test } from "bun:test"
import type { Envelope } from "@yuki/protocol"
import { decide } from "@yuki/agent/mid-run"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// Architecture section 8, "Talker and workers". Slow work runs in a background worker while the
// agent keeps talking. A scripted model and a `hang` tool the test releases make every case exact.

let mf: Miniflare

beforeAll(async () => {
  const script = await bundleWorker(new URL("./workers-worker.ts", import.meta.url))
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { T: { className: "T", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

type Hangs = { started: number; aborted: number; waiting: number }
type Status = { tasks: number; submissions: number; opens: number }
type Row = { id: string; task: string; status: string; step: string | null; delivered: boolean }
type Request = { worker: boolean; roles: string[]; users: string[] }

async function agent() {
  const ns = await mf.getDurableObjectNamespace("T")
  const id = ns.newUniqueId()
  // A fresh stub per call: after a crash the old stub is broken.
  const call = async <R>(body: unknown): Promise<R> => {
    const res = await ns.get(id).fetch("http://do/", { method: "POST", body: JSON.stringify(body) })
    return (await res.json()) as R
  }
  return {
    call,
    say: (body: string) => call({ op: "receive", envelopes: [human(body)] }),
    posts: () => call<string[]>({ op: "posts" }),
    hangs: () => call<Hangs>({ op: "hangs" }),
    release: () => call({ op: "release" }),
    workers: () => call<Row[]>({ op: "workers" }),
    status: () => call<Status>({ op: "status" }),
    requests: () => call<Request[]>({ op: "requests" }),
    transcript: () => call<{ users: string[]; assistants: string[] }>({ op: "transcript" }),
  }
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read().catch(() => undefined)
    if (value !== undefined && done(value)) return value
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`)
    await Bun.sleep(100)
  }
}

let n = 0
const human = (body: string): Envelope => ({
  id: `human:m${++n}`,
  roomId: "01J00000000000000000000000" as Envelope["roomId"],
  from: { kind: "human" },
  body,
  hop: 0,
  rootId: `m${n}`,
  seq: n,
})

/** The agent started one worker, said so, and the worker waits in `hang`. */
async function working(a: Awaited<ReturnType<typeof agent>>, task = "find the flights") {
  await a.say(`START ${task}`)
  await until(a.hangs, (h) => h.waiting === 1)
  await until(a.posts, (p) => p.some((t) => t.includes("started w1")))
}

test("(a) a human message gets an answer while a worker's tool still hangs", async () => {
  const a = await agent()
  await working(a)
  await a.say("are you there?")
  await until(a.posts, (p) => p.includes("reply to: are you there?"))
  expect((await a.hangs()).waiting).toBe(1)
  expect((await a.workers()).map((w) => [w.id, w.status])).toEqual([["w1", "running"]])
  await a.release()
}, 30_000)

test("(b) steer_work reaches the worker after its tool, and its answer reflects it", async () => {
  const a = await agent()
  await working(a)
  await a.say("STEER add pears too")
  await until(a.posts, (p) => p.some((t) => t.includes("sent to w1")))
  await a.release()
  const posts = await until(a.posts, (p) => p.some((t) => t.startsWith("reported w1 done")))
  expect(posts.find((t) => t.startsWith("reported w1 done"))).toBe("reported w1 done: worker answer; heard=find the flights | add pears too")
  const last = (await a.requests()).filter((r) => r.worker).at(-1)!
  expect(last.roles).toEqual(["user", "assistant", "toolResult", "user"])
}, 30_000)

test("(c) stop_work aborts the hanging tool, and the talker hears the worker stopped", async () => {
  const a = await agent()
  await working(a)
  await a.say("STOP")
  await until(a.hangs, (h) => h.aborted === 1)
  const posts = await until(a.posts, (p) => p.some((t) => t.startsWith("reported w1 stopped")))
  expect(posts.filter((t) => t.startsWith("reported w1")).length).toBe(1)
  expect((await a.transcript()).users.filter((u) => u.includes('<work id="w1" status="stopped">')).length).toBe(1)
  expect((await a.workers())[0]!.status).toBe("stopped")
}, 30_000)

test("(d) a finished worker reaches the talker once, even when its delivery runs twice", async () => {
  const a = await agent()
  await working(a)
  await a.release()
  await until(a.posts, (p) => p.some((t) => t.startsWith("reported w1 done")))
  await until(a.status, (s) => s.tasks === 0 && s.submissions === 0)
  await a.call({ op: "repeat" })
  await Bun.sleep(1_500)
  await until(a.status, (s) => s.tasks === 0 && s.submissions === 0)
  expect((await a.posts()).filter((t) => t.startsWith("reported w1")).length).toBe(1)
  expect((await a.transcript()).users.filter((u) => u.includes('<work id="w1" status="done">')).length).toBe(1)
}, 30_000)

test("(e) the object restarts while a worker hangs; the worker finishes and its result still reaches the talker", async () => {
  const a = await agent()
  await working(a)
  const crashed = await a.call({ op: "crash" }).then(
    () => "no crash",
    () => "crashed",
  )
  expect(crashed).toBe("crashed")
  await until(a.status, (s) => s.opens >= 2)
  await until(a.hangs, (h) => h.waiting === 1 && h.started === 2)
  await a.release()
  const posts = await until(a.posts, (p) => p.some((t) => t.startsWith("reported w1 done")), 30_000)
  expect(posts.filter((t) => t.startsWith("reported w1")).length).toBe(1)
}, 45_000)

test("(f) a fourth worker at once is refused", async () => {
  const a = await agent()
  await a.say("START4")
  const posts = await until(a.posts, (p) => p.some((t) => t.startsWith("tools said:")))
  await until(a.hangs, (h) => h.waiting === 3)
  const said = posts.find((t) => t.startsWith("tools said:"))!.split(" || ")
  expect(said.filter((t) => t.includes("started w")).length).toBe(3)
  expect(said[3]).toContain("3 workers are running")
  expect((await a.workers()).length).toBe(3)
  await a.release()
}, 30_000)

test("(g) a human message during a run that already posted a bubble steers, never queues", () => {
  expect(decide({ bubblePosted: true, toolStarted: false, toolRunning: false, queued: false, restarts: 0 }, { kind: "human" })).toBe("steer")
  expect(decide({ bubblePosted: true, toolStarted: true, toolRunning: false, queued: false, restarts: 0 }, { kind: "human" })).toBe("steer")
})
