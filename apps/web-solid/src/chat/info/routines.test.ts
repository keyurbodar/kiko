import { afterEach, describe, expect, test } from "bun:test"
import { cancelRoutine, loadRoutines, routinesOf } from "./routines"
import { triggerLabel } from "./routines-model"

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

describe("deleting a routine", () => {
  const once = { id: "m1", name: "book the table", roomId: "room-a", status: "active", trigger: { on: "time", at: "2026-10-17T09:00:00Z" }, tz: "UTC" }

  test("it leaves the list at once, and a refused delete puts it back", async () => {
    serve({ routines: [once], runs: [] })
    await loadRoutines()
    const [only] = routinesOf("room-a")!
    globalThis.fetch = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch
    const failed = cancelRoutine(only!)
    expect(routinesOf("room-a")).toEqual([])
    await failed
    expect(routinesOf("room-a")?.map((r) => r.id)).toEqual(["m1"])
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch
    await cancelRoutine(only!)
    expect(routinesOf("room-a")).toEqual([])
  })
})

describe("a repeating routine's time label", () => {
  // `at` is when the routine was made (16:48 UTC). The hours in the rule are wall-clock times in `tz`.
  const made = "2026-10-15T16:48:00Z"
  test.each([
    ["daily at a time set in the rule", "FREQ=DAILY;BYHOUR=7;BYMINUTE=55;BYSECOND=0", "Every day at 7:55 AM"],
    ["weekdays", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0", "Weekdays at 9:00 AM"],
    ["one weekday", "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=30", "Every Mon at 8:30 AM"],
    ["several times, evenly spaced", "FREQ=DAILY;BYHOUR=8,10,12,14,16,18,20,22;BYMINUTE=0", "Every 2 hours, 8 AM to 10 PM"],
    ["several times, unevenly spaced", "FREQ=DAILY;BYHOUR=8,13,20;BYMINUTE=0", "Every day at 8 AM, 1 PM, 8 PM"],
    ["several times with minutes", "FREQ=DAILY;BYHOUR=8,13;BYMINUTE=30", "Every day at 8:30 AM, 1:30 PM"],
    ["no hour in the rule, so the time of creation", "FREQ=DAILY", "Every day at 4:48 PM"],
  ])("%s", (_name, rrule, label) => {
    expect(triggerLabel({ on: "time", at: made, rrule }, "UTC")).toBe(label)
  })

  test("a time with a 2 in it keeps its digits", () => {
    expect(triggerLabel({ on: "time", at: "2026-10-15T14:20:00Z" }, "UTC")).toBe("Once, Oct 15 at 2:20 PM")
  })
})
