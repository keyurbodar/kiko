import { afterAll, beforeAll, expect, test } from "bun:test"
import type { Envelope, RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import { blocksOf } from "../src/agent/outbox"
import { debounce, deliverable, isFragment, MAX_DELIVERY_ENVELOPES } from "../src/room/burst"
import { MAX_ENTRY_BYTES, MAX_OPEN } from "@kiko/agent/inbox"
import { AFTER, BEFORE } from "./turn-fixtures"

// P1-11. The room's bubble store and the agent's outbox inside workerd, through Miniflare. The
// agent is the real `AgentDO` with a faux model, its room calls recorded, and the real alarm drives
// every run.
let mf: Miniflare
let origin: string

beforeAll(async () => {
  const script = await bundleWorker(new URL("./turn-worker.ts", import.meta.url))
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { T: { className: "T", useSQLite: true }, ROOM: { className: "RoomDO", useSQLite: true } },
  })
  origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
})

type Call =
  | { t: "post"; runId: string; attempt: number; index: number; block: string; tainted: boolean }
  | { t: "draft"; runId: string; index: number; chars: number }
  | { t: "status"; state: string }
  | { t: "end"; runId: string }

async function agent() {
  const ns = await mf.getDurableObjectNamespace("T")
  const id = ns.newUniqueId()
  const call = async <R>(body: unknown): Promise<R> => {
    const res = await ns.get(id).fetch("http://do/", { method: "POST", body: JSON.stringify(body) })
    return (await res.json()) as R
  }
  return {
    call,
    receive: (envelopes: Envelope[]) => call<{ admitted: string[] }>({ op: "receive", envelopes }),
    calls: () => call<{ calls: Call[] }>({ op: "calls" }).then((r) => r.calls),
  }
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read().catch(() => undefined)
    if (value !== undefined && done(value)) return value
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`)
    await Bun.sleep(50)
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
  tainted: false,
  seq: n,
})

const posts = (calls: Call[]) => calls.filter((c): c is Extract<Call, { t: "post" }> => c.t === "post")
const ended = (calls: Call[]) => calls.some((c) => c.t === "end")

test("the debounce follows the table in section 6.1", () => {
  expect(debounce("message", 10_000, 10_000)).toBe(11_000)
  expect(debounce("typing", 12_000, 10_000)).toBe(14_500)
  // Pending for 8 seconds: now, and never later.
  expect(debounce("message", 17_000, 10_000)).toBe(18_000)
  expect(debounce("typing", 19_000, 10_000)).toBe(18_000)
})

test("a burst past the inbox caps goes out in deliveries the inbox admits, oldest first", () => {
  // A burst the inbox refuses as full would wait forever, and one too large would be dropped.
  const many = Array.from({ length: 1_500 }, (_, i) => human(`message ${i}`))
  const first = deliverable(many)
  expect(first).toEqual(many.slice(0, MAX_DELIVERY_ENVELOPES))
  expect(first.length).toBeLessThan(MAX_OPEN)
  const long = Array.from({ length: 20 }, (_, i) => human(`${i} ${"x".repeat(15_000)}`))
  const chunk = deliverable(long)
  expect(chunk.length).toBeGreaterThan(0)
  expect(chunk).toEqual(long.slice(0, chunk.length))
  expect(new TextEncoder().encode(JSON.stringify(chunk)).length).toBeLessThan(MAX_ENTRY_BYTES / 2)
  // One message always goes, whatever its size.
  expect(deliverable([human("y".repeat(200_000))])).toHaveLength(1)
})

test("a run posts each paragraph once, in order, then ends once", async () => {
  const a = await agent()
  await a.receive([human("hello")])
  const calls = await until(a.calls, ended)
  await Bun.sleep(300)
  const after = await a.calls()
  expect(after).toEqual(calls)
  const runId = posts(calls)[0]!.runId
  expect(posts(calls).map((p) => [p.runId, p.attempt, p.index, p.block])).toEqual(blocksOf(BEFORE).map((b, i) => [runId, 0, i, b]))
  expect(calls.filter((c) => c.t === "end")).toEqual([{ t: "end", runId }])
  expect(calls.at(-1)).toEqual({ t: "end", runId })
  expect(calls[0]).toEqual({ t: "status", state: "typing" })
}, 30_000)

test("a run started by a tainted envelope posts every bubble as tainted, and a human's run does not", async () => {
  // Section 16.4: the room previews no link of a tainted run, so the outbox must say which runs are.
  const a = await agent()
  await a.receive([{ ...human("from a teammate"), id: `agent:t${n}`, from: { kind: "agent", slug: "scout" } as Envelope["from"], tainted: true }])
  const tainted = posts(await until(a.calls, ended))
  expect(tainted.length).toBe(blocksOf(BEFORE).length)
  expect(tainted.every((p) => p.tainted === true)).toBe(true)

  const b = await agent()
  await b.receive([human("hello")])
  const clean = posts(await until(b.calls, ended))
  expect(clean.length).toBe(blocksOf(BEFORE).length)
  expect(clean.every((p) => p.tainted === false)).toBe(true)
}, 30_000)

test("a crash after a bubble reposts the run under the next attempt", async () => {
  const a = await agent()
  await a.receive([human("hello")])
  await until(a.calls, (calls) => posts(calls).length > 0)
  const crashed = await a.call({ op: "crash" }).then(
    () => "no crash",
    () => "crashed",
  )
  expect(crashed).toBe("crashed")
  const calls = await until(a.calls, ended)
  const all = posts(calls)
  const first = all.filter((p) => p.attempt === 0)
  expect(first.length).toBeGreaterThan(0)
  // Posted before the crash: a prefix of the first answer, never all of it.
  expect(first.map((p) => p.block)).toEqual(blocksOf(BEFORE).slice(0, first.length))
  expect(first.length).toBeLessThan(blocksOf(BEFORE).length)
  // After the crash the model wrote different text, so the room gets a new attempt from index 0.
  expect(all.filter((p) => p.attempt === 1).map((p) => [p.index, p.block])).toEqual(blocksOf(AFTER).map((b, i) => [i, b]))
  expect(all.every((p) => p.runId === all[0]!.runId)).toBe(true)
  expect(calls.filter((c) => c.t === "end")).toHaveLength(1)
}, 40_000)

async function snapshot(roomId: string) {
  const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/room/${roomId}/ws`)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const frame = new Promise<RoomToClient>((resolve) => {
    ws.onmessage = (e) => resolve(JSON.parse(String(e.data)))
  })
  ws.send(JSON.stringify({ t: "hello", lastSeq: 9999 }))
  const reset = await frame
  ws.close()
  if (reset.t !== "reset") throw new Error(`expected a reset, got ${reset.t}`)
  return reset.snapshot.messages.map((m) => [m.run?.attempt, m.run?.index, m.text, m.rich?.length ?? 0])
}

test("a repeated post stores one message, and a higher attempt replaces the earlier one", async () => {
  const roomId = "01J00000000000000000000001"
  const post = async (attempt: number, index: number, block: string) => {
    const res = await fetch(`${origin}/room/${roomId}/post`, {
      method: "POST",
      body: JSON.stringify({ slug: "kiko", runId: "kiko:1", attempt, index, block }),
    })
    return (await res.json()) as boolean
  }
  expect(await post(0, 0, "first **bubble**")).toBe(true)
  expect(await post(0, 0, "first **bubble**")).toBe(false)
  expect(await post(0, 1, "second")).toBe(true)
  expect(await snapshot(roomId)).toEqual([
    [0, 0, "first **bubble**", 1],
    [0, 1, "second", 1],
  ])
  expect(await post(1, 0, "rewritten")).toBe(true)
  // A late post from the earlier attempt stores nothing.
  expect(await post(0, 2, "late")).toBe(false)
  expect(await snapshot(roomId)).toEqual([[1, 0, "rewritten", 1]])
}, 30_000)

test.each([
  // A short complete reply goes after the plain pause.
  ["yes", false],
  ["do it", false],
  ["sounds good", false],
  ["ok", false],
  ["hi", false],
  ["hi!", false],
  ["what time is it?", false],
  ["ok 👍", false],
  ["planning a weekend in lisbon with friends", false],
  // A thought still going: a comma, an ellipsis, or a word that cannot end it.
  ["so i was thinking,", true],
  ["maybe...", true],
  ["hmm…", true],
  ["book the flight and", true],
  ["and then the", true],
  ["put it next to", true],
  ["a dinner with", true],
  ["Because", true],
])("isFragment(%p) is %p", (text, want) => expect(isFragment(text)).toBe(want))

test("a fragment holds the burst open longer than a full message", () => {
  expect(debounce("fragment", 10_000, 10_000)).toBe(12_500)
  expect(debounce("fragment", 17_000, 10_000)).toBe(18_000)
})
