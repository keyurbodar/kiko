import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ConversationId, EntryId, StorageWrite, SubmissionId } from "@earendil-works/pi-durable"
import { JOURNAL_STEPS, JournalStorage } from "@kiko/agent/journal"
import { describe, expect, it } from "vitest"
import { journalThoughts } from "./thoughts"

const context = BACKGROUND_CONTEXT
const ROOM = 100 as ConversationId
const SUBMISSION = 200 as SubmissionId

function durable(): DurableObjectStorage {
  const db = new DatabaseSync(":memory:")
  for (const step of JOURNAL_STEPS) db.exec(step as string)
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      const reads = statement.columns().length > 0
      const rows = reads ? statement.all(...bindings) : []
      const rowsWritten = reads ? 0 : Number(statement.run(...bindings).changes)
      return { toArray: () => rows, one: () => rows[0], rowsWritten, [Symbol.iterator]: () => rows.values() }
    },
  }
  return { sql, transactionSync: <T>(run: () => T) => run() } as unknown as DurableObjectStorage
}

const entry = (id: number, kind: string, more: Record<string, unknown> = {}): StorageWrite =>
  ({ type: "entry", value: { id, conversationId: ROOM, kind, ...more } }) as StorageWrite

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function assistant(id: number, thinking: string | undefined, at: number, spent: number): StorageWrite {
  const content = [...(thinking === undefined ? [] : [{ type: "thinking", thinking }]), { type: "text", text: "ok" }]
  const message = {
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage,
    stopReason: "stop",
    timestamp: at,
    durationMs: spent,
  }
  return entry(id, "pi.assistant", { model: [message] })
}

async function seeded(): Promise<{ journal: JournalStorage; storage: DurableObjectStorage }> {
  const storage = durable()
  const journal = JournalStorage.open(storage, "room:kiko")
  await journal.commit(
    [
      { type: "conversation", value: { id: ROOM } },
      entry(101, "kiko.input", { data: { humanDeliveredSeq: 1 } }),
      assistant(102, "Quiet first.", 1_000, 600),
      entry(103, "pi.tool-result", { model: [{ role: "toolResult", content: [] }] }),
      assistant(104, undefined, 2_000, 400),
      assistant(105, "Then the walk.", 3_000, 900),
      {
        type: "submission",
        value: {
          id: SUBMISSION,
          conversationId: ROOM,
          type: "input",
          status: "done",
          entry: 101 as EntryId,
          answer: 105 as EntryId,
        },
      },
    ],
    context,
  )
  return { journal, storage }
}

const rows = (storage: DurableObjectStorage): number =>
  storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM journal").toArray()[0]!.n

describe("journalThoughts", () => {
  it("reads a run's thinking parts from the journal, one per model turn, and writes nothing", async () => {
    const { journal, storage } = await seeded()
    const before = rows(storage)

    const parts = await journalThoughts(journal, `room:kiko:${SUBMISSION}`)

    expect(parts).toEqual([
      { part: 0, text: "Quiet first.", startedAt: 1_000, spentMs: 600 },
      { part: 1, text: "", startedAt: 2_000, spentMs: 400 },
      { part: 2, text: "Then the walk.", startedAt: 3_000, spentMs: 900 },
    ])
    expect(rows(storage)).toBe(before)
  })

  it("finds the same run by the settlement sequence a journal replay names it with", async () => {
    const { journal } = await seeded()
    const settled = await journalThoughts(journal, `room:kiko:${journal.settlement(SUBMISSION)!}`)
    expect(settled.map((part) => part.text)).toEqual(["Quiet first.", "", "Then the walk."])
  })

  it("answers nothing for a run the journal does not hold", async () => {
    const { journal } = await seeded()
    expect(await journalThoughts(journal, "room:kiko:404")).toEqual([])
  })
})
