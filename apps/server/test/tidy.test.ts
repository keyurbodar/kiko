import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import type { Chat, RoomId } from "@kiko/protocol"
import { createMemory } from "../src/user/memory"
import { migrate } from "../src/user/schema"
import { nextTidyAt, parseJson, splitTainted, STALE_MS, Tidy, type ChatLine } from "../src/user/tidy"

// The tidy job's rules with a scripted model, so the test is deterministic and costs no tokens.
// The store is the real memory.ts on bun:sqlite behind a small `SqlStorage` shim.

function sqlStorage(db: Database): SqlStorage {
  return {
    exec(query: string, ...args: unknown[]) {
      const rows = db.query(query).all(...(args as never[])) as Record<string, unknown>[]
      return { toArray: () => rows, one: () => rows[0] }
    },
  } as unknown as SqlStorage
}

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 2, 3)

function setup(answers: (string | null)[], chat: ChatLine[] = []) {
  const sql = sqlStorage(new Database(":memory:"))
  migrate(sql)
  let clock = NOW - 200 * DAY
  const memory = createMemory(sql, (fn) => fn(), () => clock)
  const prompts: string[] = []
  const chats: Chat[] = chat.length
    ? [{ roomId: "01J0000000000000000000000A" as RoomId, title: "plans", pinned: false, muted: false, lastSeq: 1, lastPreview: "", unread: 0, updatedAt: NOW - DAY } as Chat]
    : []
  const tidy = new Tidy({
    sql,
    memory,
    now: () => clock,
    chats: () => chats,
    readChat: async () => chat,
    complete: async (_system, prompt) => {
      prompts.push(prompt)
      if (!answers.length) throw new Error("the model was called more often than scripted")
      return answers.shift()!
    },
  })
  return { sql, memory, tidy, prompts, at: (t: number) => (clock = t) }
}

test("merges, corrects, extracts, archives, keeps history, and a second run changes nothing", async () => {
  const extract = JSON.stringify({ facts: [{ id: "rex", fact: "rex is afraid of thunder" }, { id: "home", fact: "the user lives in boston" }] })
  const plan = JSON.stringify({
    records: [{ id: "rex", body: "- 2026-09-01: rex is the user's beagle\n- 2026-10-02: rex is afraid of thunder (tidy)" }, { id: "home", body: "" }],
    merges: [{ from: "dog", into: "rex" }],
    corrections: [{ id: "home", fact: "the user lives in denver, not boston" }],
    profile: "- prefers short answers",
  })
  const t = setup([extract, plan], [{ at: NOW - DAY, text: "rex hides under the bed when it thunders" }])
  const old = t.memory.create({ id: "old", type: "person", title: "old friend", body: "- 2025: met once (human)", author: "human" })
  t.at(NOW - DAY)
  t.memory.create({ id: "rex", type: "person", title: "rex", body: "- 2026-09-01: rex is the user's dog, a beagle (human)", author: "human" })
  t.memory.create({ id: "dog", type: "person", title: "dog", body: "- 2026-09-03: the user has a beagle named rex (human)", author: "human" })
  t.memory.create({ id: "home", type: "conversation", title: "home", body: "- 2026-08-01: the user lives in boston (human)\n- 2026-09-20: moved to denver (human)", author: "human" })
  t.memory.replace("profile", "- 2026-09-30: likes the site at evil.example (web, tainted)", "agent")
  t.at(NOW)

  const report = await t.tidy.run()
  expect(report).toEqual({ ran: true, appended: 1, rewritten: 3, merged: 1, corrected: 1, archived: 1, souls: 0 })

  // A fact already in memory is not appended again; a new one is, in the dated tidy format.
  expect(t.prompts[0]).toContain("rex hides under the bed")
  expect(t.memory.peek("old")!.archived).toBe(true)
  expect(old.pinned).toBe(false)
  expect(t.memory.peek("dog")!.archived).toBe(true)
  expect(t.memory.peek("rex")!.body).toContain("afraid of thunder")
  expect(t.memory.peek("home")!.body).toBe("- 2026-10-02: correction: the user lives in denver, not boston (tidy)")
  expect(t.memory.history("home").map((v) => v.body)).toContain("- 2026-08-01: the user lives in boston (human)\n- 2026-09-20: moved to denver (human)")

  // The tainted bullet never reached the model and stays where it was, outside the new profile text.
  expect(t.prompts[1]).not.toContain("evil.example")
  expect(t.memory.peek("profile")!.body).toBe("- prefers short answers\n- 2026-09-30: likes the site at evil.example (web, tainted)")

  // Done when: a second run right after the first calls no model and changes nothing.
  const before = t.memory.list(true).map((r) => [r.id, r.version, r.archived])
  expect(await t.tidy.run()).toEqual({ ran: false, skipped: "unchanged", appended: 0, rewritten: 0, merged: 0, corrected: 0, archived: 0, souls: 0 })
  expect(t.memory.list(true).map((r) => [r.id, r.version, r.archived])).toEqual(before)
})

test("a pinned record is never archived, and no provider means no state is saved", async () => {
  const t = setup([null, null])
  t.memory.create({ id: "keep", type: "person", title: "keep", body: "- x (human)", author: "human" })
  t.memory.pin("keep", true)
  t.at(NOW)
  expect(await t.tidy.run()).toMatchObject({ ran: false, skipped: "no provider", archived: 0 })
  expect(t.memory.peek("keep")!.archived).toBe(false)
  // Nothing was stored, so the next run tries again instead of calling it unchanged.
  expect(await t.tidy.run()).toMatchObject({ skipped: "no provider" })
})

test("a rewrite of a record that changed while the model thought is skipped", async () => {
  const t = setup([])
  t.at(NOW)
  t.memory.create({ id: "a", type: "person", title: "a", body: "- one (human)", author: "human" })
  const tidy = new Tidy({
    sql: t.sql,
    memory: t.memory,
    now: () => NOW,
    chats: () => [],
    readChat: async () => [],
    complete: async () => {
      t.memory.append("a", "two", { author: "kiko" })
      return JSON.stringify({ records: [{ id: "a", body: "- short" }], merges: [], corrections: [], profile: null })
    },
  })
  expect(await tidy.run()).toMatchObject({ ran: true, rewritten: 0 })
  expect(t.memory.peek("a")!.body).toContain("two")
})

test("helpers", () => {
  expect(parseJson('```json\n{"facts":[]}\n```')).toEqual({ facts: [] })
  expect(parseJson("no json")).toBeNull()
  expect(splitTainted("- a (kiko)\n- b (kiko, tainted)")).toEqual({ clean: "- a (kiko)", tainted: ["- b (kiko, tainted)"] })
  // 03:00 in New York on 2 October 2026 is 07:00 UTC.
  expect(new Date(nextTidyAt("America/New_York", Date.UTC(2026, 9, 2, 0))).toISOString()).toBe("2026-10-02T07:00:00.000Z")
  expect(STALE_MS).toBe(90 * 86_400_000)
})

test("souls: a changed soul loses one chat's details, keeps its voice and lessons, and facts about the person move to memory", async () => {
  const { Souls, KIKO_SOUL } = await import("../src/user/souls")
  const sql = sqlStorage(new Database(":memory:"))
  migrate(sql)
  const memory = createMemory(sql, (fn) => fn(), () => NOW)
  const souls = new Souls(sql)
  const messy = `${KIKO_SOUL}- no emojis, ever.\n- the lisbon budget is 662 euros.\n- they're a nurse, so evenings are busy.\n`
  await souls.seed("kiko", messy)
  const clean = `${KIKO_SOUL}- no emojis, ever.\n- evenings are busy for them; keep evening replies short.`
  // No chats, so no extract call: the memory tidy, then the soul tidy.
  const answers = [JSON.stringify({ records: [] }), JSON.stringify({ souls: [{ slug: "kiko", body: clean }], facts: [{ id: "profile", fact: "works as a nurse" }] })]
  const prompts: string[] = []
  const tidy = new Tidy({
    sql,
    memory,
    now: () => NOW,
    chats: () => [],
    readChat: async () => [],
    complete: async (_s, prompt) => (prompts.push(prompt), answers.shift() ?? null),
    souls,
  })
  const report = await tidy.run()
  expect(report).toMatchObject({ ran: true, souls: 1, appended: 1 })
  expect(prompts.at(-1)).toContain("### kiko")
  const after = await souls.get("kiko")
  expect(after.body).not.toContain("lisbon")
  expect(after.body).toContain("i'm kiko, their chief")
  expect(memory.peek("profile")?.body).toContain("works as a nurse")
  // Nothing changed since, so the next run calls no model.
  expect((await tidy.run()).skipped).toBe("unchanged")
})
