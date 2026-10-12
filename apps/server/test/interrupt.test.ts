import { afterAll, beforeAll, expect, test } from "bun:test"
import type { Envelope } from "@yuki/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare

beforeAll(async () => {
  const script = await bundleWorker(new URL("./interrupt-worker.ts", import.meta.url))
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { I: { className: "I", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

type Counts = { hangStarted: number; hangAborted: number; holdStarted: number; holdFinished: number }

let n = 0
const human = (body: string): Envelope => ({
  id: `human:i${++n}`,
  roomId: "01J00000000000000000000000" as Envelope["roomId"],
  from: { kind: "human" },
  body,
  hop: 0,
  rootId: `i${n}`,
  seq: n,
})

async function agent() {
  const ns = await mf.getDurableObjectNamespace("I")
  const id = ns.newUniqueId()
  const call = async <R>(body: unknown): Promise<R> => {
    const res = await ns.get(id).fetch("http://do/", { method: "POST", body: JSON.stringify(body) })
    return (await res.json()) as R
  }
  return {
    say: (body: string) => call<{ admitted: string[]; refused?: string }>({ op: "receive", envelopes: [human(body)] }),
    counts: () => call<Counts>({ op: "counts" }),
    posts: () => call<string[]>({ op: "posts" }),
    calls: () => call<string[]>({ op: "calls" }),
    release: () => call({ op: "release" }),
    wait: () => call<string | null>({ op: "wait" }),
    answer: (text: string) => call({ op: "answer", text }),
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

test("a human message during a running read stops it", async () => {
  const a = await agent()
  await a.say("HANG one")
  await until(a.counts, (c) => c.hangStarted === 1)
  await a.say("two")
  await until(a.counts, (c) => c.hangAborted === 1)
  const posts = await until(a.posts, (p) => p.includes("reply to: two"))
  expect(posts.some((t) => t.includes("released"))).toBe(false)
  expect((await a.counts()).hangStarted).toBe(1)
}, 30_000)

test("a human message during a running write does not stop it, and the write runs to its end", async () => {
  const a = await agent()
  await a.say("HOLD one")
  await until(a.counts, (c) => c.holdStarted === 1)
  await a.say("two")
  await Bun.sleep(1_500)
  expect(await a.counts()).toMatchObject({ holdStarted: 1, holdFinished: 0 })
  await a.release()
  const posts = await until(a.posts, (p) => p.includes("reply to: two"))
  expect(posts.some((t) => t.includes("aborted"))).toBe(false)
  expect((await a.counts()).holdFinished).toBe(1)
}, 30_000)

test("a human message stops a running read before the answer is submitted", async () => {
  const a = await agent()
  await a.say("HANG one")
  await until(a.counts, (c) => c.hangStarted === 1)
  await a.say("two")
  const order = await until(a.calls, (c) => c.indexOf("abort") >= 0 && c.length >= c.indexOf("abort") + 3)
  const at = order.indexOf("abort")
  expect(order.slice(at, at + 3)).toEqual(["abort", "submit", "submitted"])
}, 30_000)

test("a refused human message stops nothing that waits on an answer", async () => {
  const a = await agent()
  const waiting = a.wait()
  const refusal = await a.say("x".repeat(200_000))
  expect(refusal.refused).toBe("too_large")
  const early = await Promise.race([waiting, Bun.sleep(300).then(() => "still waiting")])
  expect(early).toBe("still waiting")
  await a.answer("yes")
  expect(await waiting).toBe("yes")
}, 30_000)

test("an admitted human message ends a wait on an answer", async () => {
  const a = await agent()
  const waiting = a.wait()
  await a.say("hello")
  expect(await waiting).toBeNull()
}, 30_000)
