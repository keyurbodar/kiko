import { expect, test } from "bun:test"
import type { Sender } from "@kiko/protocol"
import { region, ROOM_SHAPE } from "@kiko/memory/optmem"
import { hitId, mergeRecall, tagHits } from "../src/agent/recall"
import { RoomLog } from "../src/room/log"
import { RoomMemory } from "../src/room/memory"
import { ROOM_STEPS } from "../src/room/schema"
import { sqlWith } from "./sql-shim"

function room() {
  const sql = sqlWith(ROOM_STEPS)
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  let clock = Date.UTC(2026, 8, 1)
  const log = new RoomLog(storage, () => (clock += 60_000))
  const memory = new RoomMemory(storage, { get: (k) => log.meta(k), set: (k, v) => log.setMeta(k, v) })
  const human: Sender = { kind: "human" }
  const say = (text: string, run?: string) => log.addMessage({ from: run ? ({ kind: "agent", slug: "ada" } as Sender) : human, text, ...(run ? { run: { runId: run, attempt: 0, index: 0 } } : {}) })
  return { memory, say, sql, now: () => clock }
}

const noRank = async () => null

test("hit ids come from the leading #n and lines without one have none", () => {
  expect(hitId("life", "#3 2026-09-01 10:00 likes tea")).toBe("life:3")
  expect(hitId("chat", "#40 today human: hi")).toBe("chat:40")
  expect(hitId("chat", "#2-5 summary")).toBeNull()
  expect(hitId("chat", "no id here")).toBeNull()
})

test("lines already shown are left out and summarized by id", async () => {
  const shown = new Set<string>()
  const life = tagHits("life", ["#3 a", "#4 b"])
  const chat = tagHits("chat", ["#40 c", "loose"])
  expect(await mergeRecall(life, chat, shown, noRank)).toBe("life:\n#3 a\n#4 b\n\nchat:\n#40 c\nloose")
  expect(await mergeRecall(life, chat, shown, noRank)).toBe("chat:\nloose\n\nalready seen: life:3, life:4, chat:40")
})

test("more than six hits are reranked and unranked ones drop; failure keeps the order", async () => {
  const life = tagHits("life", Array.from({ length: 8 }, (_, i) => `#${i} x`))
  const out = await mergeRecall(life, [], new Set(), async (lines) => {
    expect(lines).toHaveLength(8)
    return ["life:5", "life:2"]
  })
  expect(out).toBe("life:\n#5 x\n#2 x")
  const failed = await mergeRecall(life, [], new Set(), async () => {
    throw new Error("down")
  })
  expect(failed.split("\n")).toHaveLength(9)
  expect((await mergeRecall(life, [], new Set(), noRank)).split("\n")).toHaveLength(9)
})

test("chat recall leaves out turns the agent has verbatim but keeps summarized ones and the batch skip", () => {
  const { memory, say, sql, now } = room()
  for (let i = 0; i < 80; i++) {
    say(`zebra topic ${i}`)
    say(`ack ${i}`, `r${i}`)
  }
  const count = memory.sync()
  const lo = region(count, ROOM_SHAPE)
  expect(lo).toBeGreaterThan(0)
  const posOf = (l: string) => Number(/^#(\d+)/.exec(l)![1])
  const all = memory.recall("zebra", now(), 100)
  expect(all.some((l) => posOf(l) >= lo)).toBe(true)
  const old = all.filter((l) => posOf(l) < lo)
  expect(old.length).toBeGreaterThan(0)
  const cut = memory.recall("zebra", now(), 100, count)
  expect(cut).toEqual(old)
  const mid = lo + 10
  const partial = memory.recall("zebra", now(), 100, mid).map(posOf)
  expect(partial.some((p) => p >= mid)).toBe(true)
  expect(partial.some((p) => p >= lo && p < mid)).toBe(false)
  const newest = posOf(all[0]!)
  const seq = sql.exec<{ seq: number }>("SELECT first_seq AS seq FROM mem_turns WHERE pos = ?", newest).one().seq
  expect(memory.recall("zebra", now(), 100, undefined, new Set([seq])).map(posOf)).not.toContain(newest)
  expect(memory.recall("zebra", now(), 100)).toEqual(all)
})
