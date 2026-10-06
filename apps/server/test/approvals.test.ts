import { expect, test } from "bun:test"
import type { AgentSlug, RoomEvent, RoomId } from "@kiko/protocol"
import { APPROVAL_TTL_MS, GRANT_MS, RoomApprovals } from "../src/room/approvals"
import type { RoomLog } from "../src/room/log"
import { sqlStorage } from "./sql-shim"

// Architecture sections 12.3, 16.3 and 25.3. One kind of card: the human's ok is a 30-minute grant
// for that agent over every outside tool. A card nobody answers closes quietly. Executor's pause card
// is bound to its request id, and no grant stands in for it.

const ada = "ada" as AgentSlug
const bob = "bob" as AgentSlug
const MINUTE = 60_000
const ROOM = "r1" as RoomId

function room() {
  let now = 1_000_000
  const sql = sqlStorage()
  const storage = { sql, transactionSync: <T>(f: () => T) => f() } as unknown as DurableObjectStorage
  const log = { append: (_actor: string, e: unknown) => e as RoomEvent, lastSeq: () => 0 } as unknown as RoomLog
  const approvals = new RoomApprovals(storage, log, () => now)
  let call = 0
  const ask = (slug: AgentSlug, tool: string, args: Record<string, unknown> = {}) =>
    approvals.request(slug, { kind: "grant", callKey: `run:${++call}`, tool, args, external: true })
  const cardOf = (answer: unknown) => /card (ap_\w+)/.exec((answer as { refused: string }).refused)![1]!
  return { approvals, ask, cardOf, later: (ms: number) => (now += ms) }
}

test("an accepted card lets that agent use every outside tool, with any arguments, for 30 minutes from the ok", () => {
  const { approvals, ask, cardOf, later } = room()
  const card = cardOf(ask(ada, "executor_execute", { code: "search" }).answer)
  later(3 * MINUTE)
  approvals.decide(card, "accept")
  later(GRANT_MS - MINUTE)
  // Different code, and a different outside tool: both run without a new card.
  expect(ask(ada, "executor_execute", { code: "deploy" })).toEqual({ answer: card, event: null })
  expect(ask(ada, "web_fetch", { url: "https://example.com" })).toEqual({ answer: card, event: null })
  // Another agent gets nothing from it.
  expect(typeof ask(bob, "executor_execute").answer).toBe("object")
  // Once it ends, the next call posts a card again.
  later(MINUTE + 1)
  const again = ask(ada, "web_fetch")
  expect(typeof again.answer).toBe("object")
  expect(again.event).not.toBeNull()
})

test("an agent has one open card at a time; asking again posts nothing", () => {
  const { ask, cardOf } = room()
  const first = ask(ada, "fake_send")
  expect(first.event).not.toBeNull()
  const second = ask(ada, "web_fetch")
  expect(second.event).toBeNull()
  expect(cardOf(second.answer)).toBe(cardOf(first.answer))
})

test("a declined card allows nothing and tells the agent; an accepted one tells it the grant, as the human", () => {
  const { approvals, ask, cardOf } = room()
  approvals.decide(cardOf(ask(ada, "fake_send").answer), "decline")
  expect(typeof ask(ada, "fake_send").answer).toBe("object")
  const [declined] = approvals.undelivered(ROOM)
  expect(declined!.envelope.body).toStartWith("error: the human declined fake_send")
  expect(declined!.envelope.origin).toBe("human")
  approvals.markDelivered(declined!.id)

  approvals.decide(cardOf(ask(bob, "fake_send").answer), "accept")
  const [accepted] = approvals.undelivered(ROOM)
  expect(accepted!.envelope.body).toContain("for the next 30 minutes you may act outside kiko without asking")
  expect(accepted!.envelope.body).not.toContain("exactly these arguments")
  expect(accepted!.envelope).toMatchObject({ origin: "human", hop: 0, from: { kind: "system", reason: "approval_result" } })
})

test("a card nobody answers expires after 30 minutes and wakes nobody", () => {
  const { approvals, ask, cardOf, later } = room()
  const card = cardOf(ask(ada, "fake_send").answer)
  expect(approvals.nextExpiry()).toBe(1_000_000 + APPROVAL_TTL_MS)
  later(APPROVAL_TTL_MS)
  expect(approvals.expire()).toHaveLength(1)
  expect(approvals.undelivered(ROOM)).toEqual([])
  // A late click on it changes nothing, and still delivers nothing.
  expect(approvals.decide(card, "accept")).toBeNull()
  expect(approvals.undelivered(ROOM)).toEqual([])
  expect(typeof ask(ada, "fake_send").answer).toBe("object")
})

test("resume runs only against its own accepted pause card, never against a grant", () => {
  const { approvals, ask, cardOf } = room()
  // A live grant for ada.
  approvals.decide(cardOf(ask(ada, "fake_send").answer), "accept")
  approvals.markDelivered(approvals.undelivered(ROOM)[0]!.id)

  const paused = approvals.request(ada, { kind: "pause", requestId: "apr_1", tool: "executor_resume", summary: "send the mail?", ttlMs: 15 * MINUTE })
  expect(paused.event).not.toBeNull()
  // Posting the same pause again posts nothing.
  expect(approvals.request(ada, { kind: "pause", requestId: "apr_1", tool: "executor_resume", ttlMs: 15 * MINUTE }).event).toBeNull()
  const card = cardOf(paused.answer)
  expect(typeof approvals.request(ada, { kind: "resume", requestId: "apr_1" }).answer).toBe("object")
  expect(typeof approvals.request(ada, { kind: "resume", requestId: "apr_other" }).answer).toBe("object")
  approvals.decide(card, "accept")
  expect(approvals.request(ada, { kind: "resume", requestId: "apr_1" }).answer).toBe(card)
  // Another agent cannot resume ada's pause, and another pause stays shut.
  expect(typeof approvals.request(bob, { kind: "resume", requestId: "apr_1" }).answer).toBe("object")
  expect(typeof approvals.request(ada, { kind: "resume", requestId: "apr_2" }).answer).toBe("object")
  expect(approvals.undelivered(ROOM)[0]!.envelope.body).toContain("call executor_resume with requestId apr_1 now")
})

test("a room made before this change keeps working: its table is reused as it is", () => {
  const sql = sqlStorage()
  sql.exec(`CREATE TABLE ws_approvals (id TEXT PRIMARY KEY, slug TEXT NOT NULL, run_id TEXT NOT NULL, call_key TEXT NOT NULL UNIQUE, tool TEXT NOT NULL, args_key TEXT NOT NULL, summary TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'declined', 'expired')), expires_at INTEGER NOT NULL, used_by TEXT, delivered INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL)`)
  sql.exec("CREATE INDEX ws_approvals_match ON ws_approvals (slug, args_key, state)")
  sql.exec("INSERT INTO ws_approvals (id, slug, run_id, call_key, tool, args_key, summary, state, expires_at, at) VALUES ('ap_old', 'ada', 'c', 'c:1', 'fake_send', 'fake_send:{}', 'x', 'accepted', 0, 0)")
  const storage = { sql, transactionSync: <T>(f: () => T) => f() } as unknown as DurableObjectStorage
  const log = { append: (_a: string, e: unknown) => e as RoomEvent, lastSeq: () => 0 } as unknown as RoomLog
  const approvals = new RoomApprovals(storage, log, () => 1_000)
  // An old one-shot record is no grant.
  const out = approvals.request(ada, { kind: "grant", callKey: "c:2", tool: "fake_send", args: {}, external: true })
  expect(typeof out.answer).toBe("object")
  expect(out.event).not.toBeNull()
})
