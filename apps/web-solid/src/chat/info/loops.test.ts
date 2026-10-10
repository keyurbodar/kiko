import { describe, expect, test } from "bun:test"
import { readLoops, tomorrow } from "./loops"

describe("on your plate", () => {
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
