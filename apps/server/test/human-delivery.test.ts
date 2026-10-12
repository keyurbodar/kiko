import { expect, test } from "bun:test"
import type { AgentSlug, Chat, Envelope, Task } from "@yuki/protocol"
import { MAX_ENTRY_BYTES, Inbox } from "@yuki/agent/inbox"
import { BurstFlush, type BurstDeps } from "../src/room/burst-flush"
import { Burst } from "../src/room/burst"
import { buildBrief, MAX_BOARD_BYTES } from "../src/room/brief"
import { Deliveries, withContext } from "../src/room/deliver"
import { RoomLog } from "../src/room/log"
import { RoomMail } from "../src/room/mail-drain"
import { Mail } from "../src/room/mail"
import type { MemberRow } from "../src/room/members"
import { tags } from "../src/room/recipients"
import { MAX_TASKS } from "../src/room/workspace"
import { DELIVERY_RETRY_MS } from "../src/room/wake-delivery"
import { bubbleOf, MAX_BUBBLE_BYTES } from "../src/room/whole-text"
import { migrate } from "../src/room/schema"
import { sqlStorage } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"
const NOW = 1_000_000
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada", name: "Ada", role: "", model: "", lead: true, status: "idle" } as MemberRow
const bob = { slug: "bob", name: "Bob", role: "", model: "", lead: false, status: "idle" } as MemberRow

type Turn = { ok: true } | { ok: false; limit: number; resetAt: number }

function setup(refusal: string | null, turn: Turn = { ok: true }, members: MemberRow[] = [ada, bob]) {
  const sql = sqlStorage()
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  migrate(storage)
  const log = new RoomLog(storage, () => 1)
  const clock = { now: NOW }
  const wakes: [string, number][] = []
  const received: string[][] = []
  const to: string[] = []
  const published: unknown[] = []
  const alarms = {
    setWakeup: async (name: string, at: number) => void wakes.push([name, at]),
    clearWakeup: async () => {},
  }
  const burst = new Burst(storage, alarms as never, () => clock.now)
  const env = {
    AGENT: {
      idFromName: (name: string) => name,
      get: (name: string) => ({
        receive: async (envelopes: Envelope[]) => {
          received.push(envelopes.map((e) => e.id))
          to.push(name.split(":").at(-1) ?? name)
          return { refused: refusal }
        },
      }),
    },
    USER: {
      idFromName: (name: string) => name,
      get: () => ({ takeTurn: async () => turn }),
    },
  }
  const deps: BurstDeps = {
    env: env as never,
    ctx: {} as never,
    log,
    mail: new Mail(storage, log),
    deliveries: new Deliveries(storage, log),
    publish: (events) => void published.push(...events),
    agentHome: (_h, slug) => ({ ...home, slug }),
    delivery: (_m, _ms, _g, raw) => ({ envelopes: raw, brief: "", reactionsUpTo: 0 }),
    members: { list: () => members } as never,
    burst,
    outbox: { any: () => false } as never,
    alarms: alarms as never,
    home: () => home,
    chat: async () => ({ title: "t" }) as Chat,
    seedMembers: async () => {},
    drainMail: async () => {},
    retryHeld: async () => {},
  }
  return { flush: new BurstFlush(deps), burst, log, wakes, received, to, turn, clock, published, deps, storage, sql }
}

/** A human message as the room stores it: the bubble, with the mentions of its whole text. */
async function human(burst: Burst, seq: number, text: string) {
  const bubble = bubbleOf(text)
  burst.stage({ id: `m${seq}`, seq, text: bubble }, tags(text))
  await burst.arm(bubble)
}

test("a burst the agent's inbox is full for stays pending and comes back without the human", async () => {
  const { flush, burst, log, wakes } = setup("full")
  await human(burst, 1, "hello")
  await flush.flush()
  expect(burst.pending()).toBe(true)
  expect(wakes.at(-1)).toEqual(["burst", NOW + DELIVERY_RETRY_MS])
  expect(log.snapshot().messages.filter((m) => /not delivered/.test(m.text))).toHaveLength(0)
})

test("a human message rides with the board's largest brief and is admitted", () => {
  const sql = sqlStorage()
  const inbox = new Inbox({ sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage, () => NOW)
  const tasks = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `t${i}`, owner: "ada", status: "todo", title: "漢".repeat(200), dependsOn: [] }) as unknown as Task)
  const brief = buildBrief(ada, { goal: "ship", members: [ada, bob], tasks, reactions: null })
  const envelope: Envelope = { id: "human:m1", roomId: ROOM as never, from: { kind: "human" }, body: "漢".repeat(16_000), hop: 0, rootId: "m1", seq: 1 }
  expect(new TextEncoder().encode(brief).length).toBeLessThanOrEqual(MAX_BOARD_BYTES + 2_048)
  expect(brief).toContain("more on the board")
  expect(inbox.admit([envelope], brief)).toEqual({ admitted: ["human:m1"], inserted: 1 })
})

test("the worst human message fits its inbox entry with the board at cap and three long roles", () => {
  const sql = sqlStorage()
  const inbox = new Inbox({ sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage, () => NOW)
  // Each control character is six bytes of JSON, so 16,000 of them is the largest bubble the text can give.
  const body = bubbleOf("\u001b".repeat(16_000))
  expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThanOrEqual(MAX_BUBBLE_BYTES + 2)
  // An ampersand is the widest escape in the brief's XML (five bytes), so a 400-character role of them is 2,000 bytes.
  const role = "&".repeat(400)
  const members = [ada, bob, { ...bob, slug: "cy", name: "Cy", lead: false } as MemberRow].map((m) => ({ ...m, role }))
  const tasks = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `t${i}`, owner: "ada", status: "todo", title: "&".repeat(400), dependsOn: [] }) as unknown as Task)
  const brief = buildBrief(members[0]!, { goal: "&".repeat(400), members, tasks, reactions: null, human: "keyur" })
  expect(new TextEncoder().encode(brief).length).toBeGreaterThan(MAX_BOARD_BYTES)
  const envelope: Envelope = { id: "human:m1", roomId: ROOM as never, from: { kind: "human" }, body, hop: 0, rootId: "m1", seq: 1 }
  expect(new TextEncoder().encode(JSON.stringify(envelope)).length + new TextEncoder().encode(brief).length).toBeLessThan(MAX_ENTRY_BYTES)
  expect(inbox.admit([envelope], brief)).toEqual({ admitted: ["human:m1"], inserted: 1 })
})

test("a mention past the bubble limit routes the message to the agent it names", async () => {
  const { flush, burst, to } = setup(null, { ok: true }, [{ ...ada, lead: false } as MemberRow, { ...bob, lead: true } as MemberRow])
  await human(burst, 1, `${"x".repeat(20_000)} @ada`)
  await flush.flush()
  expect(to).toEqual(["ada"])
})

test("a held burst of more than one delivery waits for the reset and does not spin before it", async () => {
  const resetAt = NOW + 60_000
  const { flush, burst, wakes } = setup(null, { ok: false, limit: 10, resetAt })
  for (let i = 1; i <= 101; i++) await human(burst, i, `m${i}`)
  await flush.flush()
  expect(wakes.at(-1)).toEqual(["burst", resetAt])
  expect(burst.pending()).toBe(false)
})

test("a held human window does not hold agent mail to its recipients", async () => {
  const resetAt = NOW + 60_000
  const { burst, log } = setup(null, { ok: false, limit: 10, resetAt })
  await human(burst, 1, "@ada hello")
  burst.hold(resetAt)
  const mail = new RoomMail({ burst, log, members: { list: () => [ada, bob] }, env: {} } as never)
  expect(mail.burstAddressed(home)).toEqual(new Set())
})

test("a human message over the daily reply limit is held and answered at the reset", async () => {
  const resetAt = NOW + 60_000
  const { flush, burst, log, wakes, received, turn, clock } = setup(null, { ok: false, limit: 10, resetAt })
  await human(burst, 1, "hello")
  await flush.flush()
  expect(burst.pending()).toBe(false)
  expect(wakes.at(-1)).toEqual(["burst", resetAt])
  expect(log.snapshot().messages.filter((m) => /answered at/.test(m.text))).toHaveLength(1)
  await flush.flush()
  expect(log.snapshot().messages.filter((m) => /answered at/.test(m.text))).toHaveLength(1)
  expect(received).toHaveLength(0)
  // The reset: the same burst is delivered, and the human has not sent again.
  Object.assign(turn, { ok: true })
  clock.now = resetAt
  await flush.flush()
  expect(burst.pending()).toBe(false)
  expect(received).toEqual([["human:m1"]])
})

test("a refused human message posts a notice to the human, one for each message", async () => {
  const { flush, burst, log, published } = setup("too_large")
  await human(burst, 1, "@ada one")
  await human(burst, 2, "@ada two")
  await flush.flush()
  const notices = log.snapshot().messages.filter((m) => /could not reach @ada/.test(m.text))
  expect(notices.map((m) => m.text)).toEqual([
    "Your message could not reach @ada: it was too large. It stays in this chat.",
    "Your message could not reach @ada: it was too large. It stays in this chat.",
  ])
  expect(published).toHaveLength(2)
  expect(burst.pending()).toBe(false)
})

test("the agent's envelope of a long human message names the file that holds its whole text", () => {
  const { log } = setup(null)
  const whole = { id: "0c4f0c4f-0000-4000-8000-000000000001", name: "attachments/abc-message.txt", type: "text/plain", size: 40_000 }
  const stored = log.addMessage({ from: { kind: "human" }, text: "x".repeat(16_000), clientId: "c1", files: [whole] })
  const envelope: Envelope = { id: `human:${stored.id}`, roomId: ROOM as never, from: { kind: "human" }, body: "x".repeat(16_000), hop: 0, rootId: stored.id, seq: stored.seq }
  expect(withContext(log, envelope).body).toContain("(attached: /attachments/abc-message.txt (text/plain, 39 kb).")
})
