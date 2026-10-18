import { expect, test } from "bun:test"
import type { AgentSlug, Chat, Envelope, Task } from "@kiko/protocol"
import { INBOX_STEPS, MAX_ENTRY_BYTES, Inbox } from "@kiko/agent/inbox"
import { BurstFlush, type BurstDeps } from "../src/room/burst-flush"
import { Burst } from "../src/room/burst"
import { buildBrief, MAX_BOARD_BYTES } from "../src/room/brief"
import { attachedLine, Deliveries, withContext } from "../src/room/deliver"
import { reactionLines } from "../src/room/reactions"
import { RoomLog } from "../src/room/log"
import { RoomMail } from "../src/room/mail-drain"
import { Mail } from "../src/room/mail"
import { Asks } from "../src/room/asks"
import { MAX_MEMBERS, type MemberRow } from "../src/room/members"
import { tags } from "../src/room/recipients"
import { MAX_TASKS } from "../src/room/workspace"
import { DELIVERY_RETRY_MS } from "../src/room/wake-delivery"
import { bubbleOf, MAX_BUBBLE_BYTES } from "../src/room/whole-text"
import { ROOM_STEPS } from "../src/room/schema"
import { sqlWith } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"
const NOW = 1_000_000
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada", name: "Ada", role: "", model: "", lead: true, status: "idle" } as MemberRow
const bob = { slug: "bob", name: "Bob", role: "", model: "", lead: false, status: "idle" } as MemberRow

function setup(refusal: string | null, members: MemberRow[] = [ada, bob]) {
  const sql = sqlWith(ROOM_STEPS)
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  const log = new RoomLog(storage, () => 1)
  const clock = { now: NOW }
  const state = { chatFails: false, chatGone: false }
  const wakes: [string, number][] = []
  const received: string[][] = []
  const to: string[] = []
  const published: unknown[] = []
  // The latest time each wakeup key holds, as the alarm table keeps it.
  const wakeups = new Map<string, number>()
  const alarms = {
    setWakeup: async (name: string, at: number) => {
      wakes.push([name, at])
      wakeups.set(name, at)
    },
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
      get: () => ({}),
    },
  }
  const deps: BurstDeps = {
    env: env as never,
    ctx: {} as never,
    log,
    mail: new Mail(storage, log, new Asks(sql)),
    deliveries: new Deliveries(storage, log),
    publish: (events) => void published.push(...events),
    agentHome: (_h, slug) => ({ ...home, slug }),
    delivery: (_m, _ms, _g, raw) => ({ envelopes: raw, brief: "", reactionsUpTo: 0 }),
    members: { list: () => members } as never,
    burst,
    outbox: { any: () => false } as never,
    alarms: alarms as never,
    home: () => home,
    chat: async () => {
      if (state.chatFails) throw new Error("chat unavailable")
      if (state.chatGone) return null
      return { title: "t" } as Chat
    },
    seedMembers: async () => {},
    drainMail: async () => {},
    retryHeld: async () => {},
  }
  return { flush: new BurstFlush(deps), burst, log, wakes, wakeups, received, to, clock, published, deps, storage, sql, state }
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
  const sql = sqlWith(INBOX_STEPS)
  const inbox = new Inbox({ sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage, () => NOW)
  const tasks = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `t${i}`, owner: "ada", status: "todo", title: "漢".repeat(200), dependsOn: [] }) as unknown as Task)
  const brief = buildBrief(ada, { goal: "ship", members: [ada, bob], tasks, reactions: null })
  const envelope: Envelope = { id: "human:m1", roomId: ROOM as never, from: { kind: "human" }, body: "漢".repeat(16_000), hop: 0, rootId: "m1", seq: 1 }
  expect(new TextEncoder().encode(brief).length).toBeLessThanOrEqual(MAX_BOARD_BYTES + 2_048)
  expect(brief).toContain("more on the board")
  expect(inbox.admit([envelope], brief)).toEqual({ admitted: ["human:m1"], inserted: 1 })
})

test("the worst human message fits its inbox entry, and the test prints the measured margin under the 128 KiB limit", () => {
  const sql = sqlWith(INBOX_STEPS)
  const inbox = new Inbox({ sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage, () => NOW)
  // The bubble: 16,000 control characters, six bytes of JSON each, the largest bubble the text can give.
  const bubble = bubbleOf("\u001b".repeat(16_000))
  // The reply quote withContext adds: 600 control characters, the longest quote it keeps.
  const reply = `(replying to @m0, about this part: "${"\u001b".repeat(600)}")`
  // The room's most members, each with a 400-character role (the brief names the whole role, five bytes per character) and a 60-character name.
  const roster = [ada, ...Array.from({ length: MAX_MEMBERS - 1 }, (_, i) => ({ ...bob, slug: `m${i}`, name: "&".repeat(60), lead: false }) as MemberRow)].map((m) => ({
    ...m,
    role: "&".repeat(400),
  }))
  const tasks = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `t${i}`, owner: "ada", status: "todo", title: "&".repeat(400), dependsOn: [] }) as unknown as Task)
  // Every member but the recipient is doing something long, and the first of them holds 60 paths of 500 characters.
  const holds = Array.from({ length: 60 }, (_, i) => `${"&".repeat(500)}${i}`)
  const team = Object.fromEntries(roster.slice(1).map((m, i) => [m.slug, { doing: "&".repeat(500), holds: i === 0 ? holds : [] }]))
  // Forty reactions by a 33-character actor, each on a 60-character quote.
  const reactions = reactionLines(Array.from({ length: 40 }, () => ({ by: `@${"a".repeat(32)}`, emoji: "❤️‍🔥", text: "&".repeat(60) })))
  const brief = buildBrief(roster[0]!, {
    goal: "&".repeat(500),
    members: roster,
    tasks,
    reactions,
    human: "&".repeat(60),
    team,
  })
  expect(new TextEncoder().encode(brief).length).toBeGreaterThan(MAX_BOARD_BYTES)
  expect(brief).toContain("and 59 more")
  // 100 attachments with 120-character names of control characters, the largest a message can carry.
  const files = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, name: "\u001b".repeat(120), size: 1_000_000, type: "text/plain" }))
  const line = attachedLine(files)
  expect(line).toContain("and 95 more")
  const body = `${reply}\n${bubble}\n${line}`
  const envelope: Envelope = { id: "human:m1", roomId: ROOM as never, from: { kind: "human" }, body, hop: 0, rootId: "m1", seq: 1 }
  const entry = new TextEncoder().encode(JSON.stringify(envelope)).length + new TextEncoder().encode(brief).length
  console.log(`worst entry: ${entry} bytes of ${MAX_ENTRY_BYTES}, margin ${MAX_ENTRY_BYTES - entry}`)
  expect(entry, `the worst entry is ${entry} bytes, the limit is ${MAX_ENTRY_BYTES} (${MAX_ENTRY_BYTES - entry} bytes of margin)`).toBeLessThan(MAX_ENTRY_BYTES)
  expect(inbox.admit([envelope], brief)).toEqual({ admitted: ["human:m1"], inserted: 1 })
})

test("a long doing text and a long handle are cut in the brief", () => {
  const brief = buildBrief(ada, {
    goal: "g",
    members: [ada, { ...bob, role: "" }],
    tasks: [],
    reactions: null,
    human: "h".repeat(300),
    team: { bob: { doing: "d".repeat(5_000), holds: [] } },
  })
  const lines = brief.split("\n")
  expect(lines.find((l) => l.includes("now "))).toContain(`now ${"d".repeat(80)}...`)
  // The human line: a 40-character handle, then the hint.
  expect(lines.find((l) => l.startsWith("the human is"))?.length).toBeLessThan(300)
})

test("a mention past the bubble limit routes the message to the agent it names", async () => {
  const { flush, burst, to } = setup(null, [{ ...ada, lead: false } as MemberRow, { ...bob, lead: true } as MemberRow])
  await human(burst, 1, `${"x".repeat(20_000)} @ada`)
  await flush.flush()
  expect(to).toEqual(["ada"])
})

test("a burst for a chat that is gone is dropped", async () => {
  const { flush, burst, log, state, received } = setup(null)
  log.setMeta("title", "t")
  state.chatGone = true
  await human(burst, 1, "hello")
  await flush.flush()
  expect(received).toEqual([])
  expect(burst.pending()).toBe(false)
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

test("the agent's envelope names the workspace files the human dragged into the message, so it reads them", () => {
  const { log } = setup(null)
  const text = "compare [a.ts](/src/a.ts) with [Plan (v2).md](</notes/Plan (v2).md>) and [site](https://x.com/a) and [a.ts](/src/a.ts)"
  const stored = log.addMessage({ from: { kind: "human" }, text, clientId: "c2" })
  const envelope: Envelope = { id: `human:${stored.id}`, roomId: ROOM as never, from: { kind: "human" }, body: text, hop: 0, rootId: stored.id, seq: stored.seq }
  expect(withContext(log, envelope).body).toContain("(referenced: /src/a.ts, /notes/Plan (v2).md. open a file with read, or list a folder with ls, before you answer about it.)")
})

test("an upload the message carries is attached, not referenced", () => {
  const { log } = setup(null)
  const file = { id: "0c4f0c4f-0000-4000-8000-000000000002", name: "attachments/abc-a.txt", type: "text/plain", size: 10 }
  const text = "see [a.txt](/attachments/abc-a.txt)"
  const stored = log.addMessage({ from: { kind: "human" }, text, clientId: "c3", files: [file] })
  const envelope: Envelope = { id: `human:${stored.id}`, roomId: ROOM as never, from: { kind: "human" }, body: text, hop: 0, rootId: stored.id, seq: stored.seq }
  const body = withContext(log, envelope).body
  expect(body).toContain("(attached: /attachments/abc-a.txt")
  expect(body).not.toContain("(referenced:")
})
