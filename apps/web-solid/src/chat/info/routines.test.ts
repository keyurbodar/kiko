import { afterEach, describe, expect, test } from "bun:test"
import { loadRoutines, routinesOf } from "./routines"

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

const serve = (body: unknown) => {
  globalThis.fetch = (async () => Response.json(body)) as unknown as typeof fetch
}

const trigger = { on: "time", at: "2026-10-15T09:00:00Z", rrule: "FREQ=DAILY" }

describe("a chat's routines", () => {
  test("a routine shows only in the chat it belongs to", async () => {
    serve({
      routines: [
        { id: "r1", name: "daily standup", roomId: "room-a", status: "active", trigger, tz: "UTC" },
        { id: "r2", name: "quarterly launch readiness review", roomId: "room-b", status: "paused", trigger, tz: "UTC" },
      ],
      runs: [],
    })
    await loadRoutines()
    expect(routinesOf("room-a")?.map((r) => r.name)).toEqual(["daily standup"])
    expect(routinesOf("room-b")?.map((r) => r.name)).toEqual(["quarterly launch readiness review"])
    expect(routinesOf("room-c")).toEqual([])
  })
})
