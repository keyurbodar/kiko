import { expect, test } from "bun:test"
import type { AgentSlug, RoomEvent } from "@kiko/protocol"
import { RoomApprovals } from "../src/room/approvals"
import type { RoomLog } from "../src/room/log"
import { sqlStorage } from "./sql-shim"

const ada = "ada" as AgentSlug
const bob = "bob" as AgentSlug
const MINUTE = 60_000

function room() {
  let now = 1_000_000
  const sql = sqlStorage()
  const storage = { sql, transactionSync: <T>(f: () => T) => f() } as unknown as DurableObjectStorage
  const log = { append: (_actor: string, e: unknown) => e as RoomEvent, lastSeq: () => 0 } as unknown as RoomLog
  const approvals = new RoomApprovals(storage, log, () => now)
  let call = 0
  const ask = (slug: AgentSlug, tool: string, args: Record<string, unknown>, grantMs?: number) =>
    approvals.request(slug, { callKey: `run:${++call}`, tool, args, ...(grantMs ? { grantMs } : {}) }).answer
  const cardOf = (answer: unknown) => /card (ap_\w+)/.exec((answer as { refused: string }).refused)![1]!
  return { approvals, ask, cardOf, later: (ms: number) => (now += ms) }
}

test("an accepted grant lets the same agent use the same tool with any arguments until it ends", () => {
  const { approvals, ask, cardOf, later } = room()
  const card = cardOf(ask(ada, "executor_execute", { code: "search" }, 15 * MINUTE))
  approvals.decide(card, "accept")
  // The agent writes different code after the approval: it runs, without a new card.
  expect(ask(ada, "executor_execute", { code: "search again, differently" }, 15 * MINUTE)).toBe(card)
  expect(ask(ada, "executor_execute", { code: "deploy" }, 15 * MINUTE)).toBe(card)
  // Another agent, or another tool, gets nothing from it.
  expect(typeof ask(bob, "executor_execute", { code: "search" }, 15 * MINUTE)).toBe("object")
  expect(typeof ask(ada, "web_fetch", { url: "https://example.com" })).toBe("object")
  // Once it ends, the next call asks again.
  later(15 * MINUTE + 1)
  expect(typeof ask(ada, "executor_execute", { code: "one more" }, 15 * MINUTE)).toBe("object")
})

test("a grant starts when the human accepts, not when the card was posted", () => {
  const { approvals, ask, cardOf, later } = room()
  const card = cardOf(ask(ada, "executor_execute", { code: "a" }, 15 * MINUTE))
  later(3 * MINUTE)
  approvals.decide(card, "accept")
  // 17 minutes after the card was posted, 14 after the ok.
  later(14 * MINUTE)
  expect(ask(ada, "executor_execute", { code: "b" }, 15 * MINUTE)).toBe(card)
})

test("a declined grant allows nothing, and a card without a grant still lets exactly one call through", () => {
  const { approvals, ask, cardOf } = room()
  approvals.decide(cardOf(ask(ada, "executor_execute", { code: "a" }, 15 * MINUTE)), "decline")
  expect(typeof ask(ada, "executor_execute", { code: "b" }, 15 * MINUTE)).toBe("object")

  const once = cardOf(ask(ada, "web_fetch", { url: "https://example.com" }))
  approvals.decide(once, "accept")
  expect(typeof ask(ada, "web_fetch", { url: "https://example.org" })).toBe("object")
  expect(ask(ada, "web_fetch", { url: "https://example.com" })).toBe(once)
  expect(typeof ask(ada, "web_fetch", { url: "https://example.com" })).toBe("object")
})
