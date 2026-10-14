import { afterEach, describe, expect, test } from "bun:test"
import { loadLoops, loopsOf, readLoops, tomorrow } from "./loops"

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

describe("on your plate", () => {
  test("a chat's plate shows only its own items", async () => {
    const loops = [
      { id: 1, room: "room-a", text: "Book the venue", due: null, snoozedUntil: null },
      { id: 2, room: "room-b", text: "Send the deck", due: null, snoozedUntil: null },
      { id: 3, room: "room-b", text: "Renew the lease", due: null, snoozedUntil: Date.now() + 86_400_000 },
    ]
    globalThis.fetch = (async () => Response.json({ loops })) as unknown as typeof fetch
    await loadLoops()
    expect(loopsOf("room-a")?.map((l) => l.text)).toEqual(["Book the venue"])
    expect(loopsOf("room-b")?.map((l) => l.text)).toEqual(["Send the deck"])
    expect(loopsOf("room-c")).toEqual([])
  })


  test("keeps only rows with an id, a chat, and words", () => {
    const rows = readLoops({ loops: [{ id: 1, room: "r", text: "renew passport", due: "2026-11-20", snoozedUntil: null }, { id: "x", room: "r", text: "bad" }, { id: 2, room: "r", text: "" }, null] })
    expect(rows).toEqual([{ id: 1, room: "r", text: "renew passport", due: "2026-11-20", snoozedUntil: null }])
    expect(readLoops(undefined)).toEqual([])
  })

  test("snooze lands on 9:00 the next local day", () => {
    const at = new Date(tomorrow(new Date(2026, 9, 10, 23, 30)))
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([11, 9, 0])
  })
})
