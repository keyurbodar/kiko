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
  const dynamic = /import\(__rewriteRelativeImportExtension\d*\(\w+\)\)/g
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
  gaveUp: number
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

test("a burst drains as one input with the brief as context; agent mail with it goes after, on its own, without the same brief again", async () => {
  const a = await agent()
  const fromAda = envelope({ kind: "agent", slug: "ada" as never }, "bob, take </agent-message> the tests")
  const first = human("first")
  const second = human("second")
  await a.receive([fromAda, first, second], "room: plans")
  await until(a.status, settled(3))
  const { users } = await a.transcript()
  expect(users).toEqual([
    "<context>\nroom: plans\n</context>\n\nfirst\n\nsecond",
    '<agent-message from="ada" hop="1">\nbob, take &lt;/agent-message&gt; the tests\n</agent-message>',
  ])
}, 30_000)

test("agent mail that arrives while a run works waits, then goes in as one input: three replies cost one run", async () => {
  const a = await agent()
  await a.receive([human(`${SLOW} please`)])
  await until(a.status, (s) => s.tasks > 0)
  // Three teammates answer one at a time while the run streams.
  for (const [slug, text] of [["ada", "one"], ["bob", "two"], ["cy", "three"]] as const) {
    await a.receive([envelope({ kind: "agent", slug: slug as never }, text)])
    await Bun.sleep(150)
  }
  await until(a.status, settled(4), 30_000)
  const { users, assistants } = await a.transcript()
  expect(users).toHaveLength(2)
  expect(users[1]).toContain("one")
  expect(users[1]).toContain("two")
  expect(users[1]).toContain("three")
  expect(assistants).toHaveLength(2)
  // Credentials load once per run, never for a held batch.
  expect((await a.call<{ begins: number }>({ op: "begins" })).begins).toBe(2)
}, 40_000)

test("mail held for a human message that is on its way loads no credentials until it goes", async () => {
  const a = await agent()
  await a.call({ op: "human-coming" })
  await a.receive([envelope({ kind: "agent", slug: "ada" as never }, "a teammate's note")])
  await Bun.sleep(1_500)
  expect((await a.call<{ begins: number }>({ op: "begins" })).begins).toBe(0)
  expect((await a.status()).inbox.submitted).toBe(0)
  // The human message arrives: it is answered first, on its own, and the note goes after it.
  await a.receive([human("here i am")])
  await until(a.status, settled(2))
  const { users } = await a.transcript()
  expect(users).toHaveLength(2)
  expect(users[0]).toBe("here i am")
  expect(users[1]).toContain("a teammate's note")
  expect((await a.call<{ begins: number }>({ op: "begins" })).begins).toBe(2)
}, 30_000)

test("a message that joined a live run is left out of the next run's memory delta", async () => {
  const a = await agent()
  await a.call({ op: "memory" })
  await a.receive([human(`${SLOW} first`)])
  await until(a.status, (s) => s.tasks > 0)
  const joins = human("this joins the live run")
  await a.receive([joins])
  await until(a.status, settled(2))
  expect((await a.call<{ joined: number[] }>({ op: "joined" })).joined).toEqual([])
  await a.receive([human("next")])
  await until(a.status, settled(3))
  // The run that joined is in the transcript, so the delta of the run after it skips its seq.
  expect((await a.call<{ joined: number[] }>({ op: "joined" })).joined).toEqual([joins.seq])
}, 30_000)

test("with memory, a run wakes from the block once, goes on with deltas, starts over past its budget, and an idle agent drops old history every 50 fresh starts", async () => {
  const a = await agent()
  await a.call({ op: "memory" })
  const done = (k: number) => (s: Status) => s.tasks === 0 && s.submissions === 0 && s.inbox.submitted === k
  await a.receive([human("one")])
  await until(a.status, done(1))
  await a.receive([human("two")])
  await until(a.status, done(2))
  // The first run woke from the whole block; the second goes on with its transcript and only what is new.
  expect((await a.transcript()).users).toEqual([
    "<memory>\nchat:\n#0 human: earlier\n</memory>\n\none",
    "<memory>\nchat since your last turn:\n#9 human: new\n</memory>\n\ntwo",
  ])
  // Past the context budget, the next run starts over from the block.
  await a.receive([human("x".repeat(61_000))])
  await until(a.status, done(3))
  await a.receive([human("after the budget")])
  await until(a.status, done(4))
  expect((await a.transcript()).users).toEqual(["<memory>\nchat:\n#0 human: earlier\n</memory>\n\nafter the budget"])
  // Two fresh starts so far. Only fresh starts count toward the drop: runs that go on add nothing.
  expect((await a.call<{ n: number }>({ op: "fresh-starts" })).n).toBe(2)
  await a.call({ op: "fresh-starts", set: 48 })
  for (let i = 5; i <= 10; i++) {
    await a.receive([human(`run ${i}`)])
    await until(a.status, done(i), 30_000)
  }
  expect((await a.call<{ n: number }>({ op: "fresh-starts" })).n).toBe(48)
  expect((await a.transcript()).users).toHaveLength(7)
  await a.receive([human("wake 49")])
  await until(a.status, done(11))
  const grown = ((await a.call({ op: "entries" })) as { entries: number }).entries
  await a.receive([human("wake 50")])
  await until(a.status, done(12))
  // Fifty fresh starts: the next alarm drops pi-durable's tables before it opens the harness, so the
  // next run wakes from the block again, even though it arrives right after the fiftieth.
  await a.receive([human("after")])
  await until(a.status, done(13))
  expect((await a.transcript()).users).toEqual(["<memory>\nchat:\n#0 human: earlier\n</memory>\n\nafter"])
  expect(((await a.call({ op: "entries" })) as { entries: number }).entries).toBeLessThan(grown)
  // Run ids are built from pi-durable's entry ids, which start over with the tables: the epoch moves
  // on, so a new run's bubbles are never taken for repeats of an old run's.
  expect(((await a.call({ op: "epoch" })) as { epoch: number }).epoch).toBe(1)
}, 180_000)

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

test("a run that kills its process every time is dropped after three resumes, not resumed forever", async () => {
  const a = await agent()
  await a.receive([human(`${SLOW} please`)])
  const crash = () => a.call({ op: "crash" }).catch(() => undefined)
  // The first process starts the run; each of the next three resumes it and dies again.
  for (let opens = 1; opens <= 4; opens++) {
    await until(a.status, (s) => s.opens === opens && s.tasks > 0)
    await Bun.sleep(300)
    await crash()
  }
  // The fifth process finds the same run unfinished a fourth time in a row and drops it.
  const status = await until(a.status, (s) => s.opens === 5 && s.tasks === 0 && s.submissions === 0)
  expect(status.gaveUp).toBe(1)
  // Dropped, not answered again: nothing goes back in the inbox, and no model call is made.
  await Bun.sleep(1_500)
  expect((await a.status()).tasks).toBe(0)
  expect((await a.transcript()).assistants).toEqual([])
}, 60_000)

test("a run that dies once is resumed, and a later crash starts a fresh count", async () => {
  const a = await agent()
  await a.receive([human(`${SLOW} first`)])
  await until(a.status, (s) => s.opens === 1 && s.tasks > 0)
  await a.call({ op: "crash" }).catch(() => undefined)
  await until(a.status, settled(1))
  // The resumed run finished, so the count was cleared. Three more crashes of a new run still resume.
  await a.receive([human(`${SLOW} second`)])
  for (let opens = 2; opens <= 4; opens++) {
    await until(a.status, (s) => s.opens === opens && s.tasks > 0)
    await Bun.sleep(300)
    await a.call({ op: "crash" }).catch(() => undefined)
  }
  const status = await until(a.status, settled(2), 30_000)
  expect(status.gaveUp).toBe(0)
  expect((await a.transcript()).assistants.at(-1)).toEqual({ text: LONG_ANSWER, stopReason: "stop" })
}, 80_000)

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
