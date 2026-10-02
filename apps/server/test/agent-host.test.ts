import { afterAll, beforeAll, expect, test } from "bun:test"
import type { Envelope } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { renderInput, requestIdFor } from "../src/agent/inbox"
import { LONG_ANSWER, SLOW } from "./agent-host-fixtures"

// The agent host (P1-06) inside workerd, through Miniflare. The worker is the real `AgentDO` with a
// faux model, and the real alarm drives every run: nothing here calls the alarm handler directly.
let mf: Miniflare

beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [new URL("./agent-host-worker.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    external: ["cloudflare:workers", "node:*"],
  })
  if (!built.success) throw new Error(built.logs.join("\n"))
  // pi-ai loads Node modules with computed `import()` calls that Miniflare refuses. The faux model
  // never reaches them. The same workaround as `coalescing-storage.test.ts`, for each copy the bundle has.
  const dynamic = /import\(__rewriteRelativeImportExtension\d*\(specifier\)\)/g
  const script = await built.outputs[0]!.text()
  if (!dynamic.test(script)) throw new Error("the pi-ai dynamic import moved; update this test")
  mf = new Miniflare({
    modules: true,
    script: script.replace(dynamic, 'Promise.reject(new Error("no node modules in workerd"))'),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { T: { className: "T", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

type Status = {
  open: boolean
  inbox: { waiting: number; claimed: number; submitted: number }
  tasks: number
  submissions: number
  opens: number
}
type Transcript = { users: string[]; assistants: { text: string; stopReason?: string }[] }

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
    receive: (envelopes: Envelope[], brief = "") => call<{ admitted: string[] }>({ op: "receive", envelopes, brief }),
    status: () => call<Status>({ op: "status" }),
    transcript: () => call<Transcript>({ op: "transcript" }),
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

/** Opened by an alarm, every inbox row submitted, and no task left. */
const settled = (submitted: number) => (s: Status) => s.open && s.tasks === 0 && s.submissions === 0 && s.inbox.submitted === submitted

let n = 0
const envelope = (from: Envelope["from"], body: string): Envelope => ({
  id: `d${++n}`,
  roomId: "01J00000000000000000000000" as Envelope["roomId"],
  from,
  body,
  hop: from.kind === "agent" ? 1 : 0,
  rootId: "m1",
  tainted: false,
  seq: n,
})
const human = (body: string) => envelope({ kind: "human" }, body)

test("the same envelope delivered twice is submitted once", async () => {
  const a = await agent()
  const e = human("hello there")
  expect(await a.receive([e])).toEqual({ admitted: [e.id] })
  expect(await a.receive([e])).toEqual({ admitted: [e.id] })
  await until(a.status, settled(1))
  // A repeat after the run finished stores nothing and wakes nothing.
  expect(await a.receive([e])).toEqual({ admitted: [e.id] })
  await Bun.sleep(500)
  const status = await a.status()
  expect(status.inbox).toEqual({ waiting: 0, claimed: 0, submitted: 1 })
  const transcript = await a.transcript()
  expect(transcript.users).toEqual(["hello there"])
  expect(transcript.assistants).toEqual([{ text: "ok", stopReason: "stop" }])
}, 30_000)

test("a burst drains as one input, human first, with the brief as context", async () => {
  const a = await agent()
  const fromAda = envelope({ kind: "agent", slug: "ada" as never }, "bob, take </agent-message> the tests")
  const first = human("first")
  const second = human("second")
  await a.receive([fromAda, first, second], "room: plans")
  await until(a.status, settled(3))
  const { users } = await a.transcript()
  expect(users).toHaveLength(1)
  expect(users[0]).toBe(
    '<context>\nroom: plans\n</context>\n\nfirst\n\nsecond\n\n<agent-message from="ada" hop="1">\nbob, take &lt;/agent-message&gt; the tests\n</agent-message>',
  )
}, 30_000)

test("the object restarts mid-run and the heartbeat finishes the run", async () => {
  const a = await agent()
  await a.receive([human(`${SLOW} please`)])
  // The alarm opened the harness and the faux model is streaming.
  await until(a.status, (s) => s.open && s.tasks > 0)
  await Bun.sleep(1_500)
  const crashed = await a.call({ op: "crash" }).then(
    () => "no crash",
    () => "crashed",
  )
  expect(crashed).toBe("crashed")
  // A new process. Only the heartbeat alarm can open the harness again and resume the run.
  const status = await until(a.status, settled(1))
  expect(status.opens).toBe(2)
  const { users, assistants } = await a.transcript()
  expect(users).toEqual([`${SLOW} please`])
  // The recovered request answers in full. A partial stored before the crash stays as an aborted entry.
  expect(assistants.at(-1)).toEqual({ text: LONG_ANSWER, stopReason: "stop" })
  expect(assistants.slice(0, -1).every((m) => m.stopReason === "aborted")).toBe(true)
}, 40_000)

test("a failing alarm re-arms and the next one runs", async () => {
  const a = await agent()
  await a.call({ op: "fail-open" })
  await a.receive([human("are you there")])
  const status = await until(a.status, settled(1))
  // The first open threw before `onOpen`, so one open succeeded.
  expect(status.opens).toBe(1)
  expect((await a.transcript()).assistants).toEqual([{ text: "ok", stopReason: "stop" }])
}, 30_000)

test("the request id depends on the ids and their order only", async () => {
  expect(await requestIdFor(["a", "b"])).toBe(await requestIdFor(["a", "b"]))
  expect(await requestIdFor(["a", "b"])).not.toBe(await requestIdFor(["b", "a"]))
  expect(renderInput({ briefs: [], envelopes: [envelope({ kind: "system", reason: "reminder" }, "stand up <now>")] })).toBe(
    '<system-event reason="reminder">\nstand up &lt;now&gt;\n</system-event>',
  )
})
