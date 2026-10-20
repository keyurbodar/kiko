import { ownerRoomFixture } from "./owner-room-fixture"
import { expect, test } from "bun:test"
import type { Sender } from "@kiko/protocol"
import { region, ROOM_SHAPE } from "@kiko/memory/optmem"
import { hitId, mergeRecall, tagHits } from "../src/agent/recall"
import { RoomMemory } from "../src/room/memory"

function room() {
  let clock = Date.UTC(2026, 8, 1)
  const { sql, storage, log, search } = ownerRoomFixture({ now: () => (clock += 60_000) })
  const memory = new RoomMemory(storage, log.roomId, { get: (k) => log.meta(k), set: (k, v) => log.setMeta(k, v) }, search)
  const human: Sender = { kind: "human" }
  const say = (text: string, run?: string) => log.addMessage({ from: run ? ({ kind: "agent", slug: "ada" } as Sender) : human, text, ...(run ? { run: { runId: run, attempt: 0, index: 0 } } : {}) })
  return { memory, say, sql, now: () => clock }
}

test("hit ids come from the leading #n and lines without one have none", () => {
  expect(hitId("life", "#3 2026-09-01 10:00 likes tea")).toBe("life:3")
  expect(hitId("chat", "#40 today human: hi")).toBe("chat:40")
  expect(hitId("chat", "#2-5 summary")).toBeNull()
  expect(hitId("chat", "no id here")).toBeNull()
})

test("lines already shown are left out and summarized by id", () => {
  const shown = new Set<string>()
  const life = tagHits("life", ["#3 a", "#4 b"])
  const chat = tagHits("chat", ["#40 c", "loose"])
  expect(mergeRecall(life, chat, shown)).toBe("life:\n#3 a\n#4 b\n\nchat:\n#40 c\nloose")
  expect(mergeRecall(life, chat, shown)).toBe("chat:\nloose\n\nalready seen: life:3, life:4, chat:40")
})

test("more than six hits are capped, and the chat keeps a share", () => {
  const life = tagHits("life", Array.from({ length: 8 }, (_, i) => `#${i} x`))
  expect(mergeRecall(life, [], new Set()).split("\n")).toHaveLength(7)
  const chat = tagHits("chat", Array.from({ length: 8 }, (_, i) => `#${i} y`))
  const both = mergeRecall(life, chat, new Set())
  expect(both.match(/ x/g)).toHaveLength(3)
  expect(both.match(/ y/g)).toHaveLength(3)
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
