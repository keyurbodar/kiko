import { describe, expect, test } from "bun:test"
import type { AgentSlug, RoomEvent } from "@kiko/protocol"
import { Trigger } from "@kiko/protocol/schema"
import { Schema } from "effect"
import { matches, routineRun, Signal, signalOf, SignalWindow } from "../src/room/signals"
import { sqlWith } from "./sql-shim"
import { ROOM_STEPS } from "../src/room/schema"
import { describeTrigger, nextEvery } from "../src/user/reminders"
import { matchWebhook, type RoomRoutine } from "../src/user/routines"

describe("triggers (section 25.4)", () => {
  const decode = Schema.decodeUnknownSync(Trigger)

  test("the schema takes each trigger and refuses a watch faster than 15 minutes or too many conditions", () => {
    expect(() => decode({ on: "time", at: "2026-10-06T08:00:00+02:00", rrule: "FREQ=DAILY" })).not.toThrow()
    expect(() => decode({ on: "watch", url: "https://example.com", everyMinutes: 15 })).not.toThrow()
    expect(() => decode({ on: "watch", url: "https://example.com", everyMinutes: 5 })).toThrow()
    expect(() => decode({ on: "webhook", match: Array.from({ length: 9 }, () => ({ path: "a", equals: 1 })) })).toThrow()
    expect(() => decode({ on: "message", from: "robot" })).toThrow()
    expect(() => decode({ on: "cron", spec: "* * * * *" })).toThrow()
  })

  test("a webhook body matches only when every condition holds", () => {
    const body = { action: "opened", pull_request: { title: "Fix login", number: 7, draft: false } }
    expect(matchWebhook([], body)).toBe(true)
    expect(matchWebhook([{ path: "action", equals: "opened" }, { path: "pull_request.title", contains: "fix" }], body)).toBe(true)
    expect(matchWebhook([{ path: "pull_request.number", equals: 7 }, { path: "pull_request.draft", equals: false }], body)).toBe(true)
    expect(matchWebhook([{ path: "action", equals: "closed" }], body)).toBe(false)
    expect(matchWebhook([{ path: "missing.path", contains: "x" }], body)).toBe(false)
    expect(matchWebhook([{ path: "action" }], null)).toBe(false)
  })

  const ctx = { roomId: "r1", at: 0, by: { kind: "human" } as const }
  const at = { seq: 1, at: 0 }
  const r = (trigger: RoomRoutine["trigger"]): RoomRoutine => ({ id: "r", target: "yuki", trigger })

  test("room events match by kind, status, sender, text, and path prefix", () => {
    const task = signalOf({ ...at, t: "task", task: { id: "t", title: "ship", status: "review", dependsOn: [] } } as RoomEvent, ctx)!
    const human = signalOf({ ...at, t: "message", id: "m", from: { kind: "human" }, text: "Deploy it" } as RoomEvent, ctx)!
    const file = signalOf({ ...at, t: "file", file: { id: "f", name: "reports/q3.md", size: 1, type: "text/markdown" } } as RoomEvent, ctx)!
    expect(matches(r({ on: "task", status: ["review"] }), task)).toBe(true)
    expect(matches(r({ on: "task", status: ["done"] }), task)).toBe(false)
    expect(matches(r({ on: "task" }), task)).toBe(true)
    expect(matches(r({ on: "message", from: "human", contains: "deploy" }), human)).toBe(true)
    expect(matches(r({ on: "message", from: "agent" }), human)).toBe(false)
    expect(matches(r({ on: "file", path: "/reports/" }), file)).toBe(true)
    expect(matches(r({ on: "file", path: "report" }), file)).toBe(false)
    expect(signalOf({ ...at, t: "message", id: "m", from: { kind: "system", reason: "reminder" }, text: "x" } as RoomEvent, ctx)).toBeNull()
  })

  test("a batch fires a routine once, never for its own agent's acts or a run an event started", () => {
    const say = (text: string, by: Parameters<typeof signalOf>[1]["by"]) => signalOf({ ...at, t: "message", id: "m", from: by?.kind === "agent" ? { kind: "agent", slug: by.slug } : { kind: "human" }, text } as RoomEvent, { ...ctx, by })!
    const agent = (slug: string, eventRun = false) => ({ kind: "agent" as const, slug, name: slug, eventRun })
    const batch = (...signals: Signal[]) => ({ roomId: "r1", openedAt: 0, signals, more: 0 })
    const any = r({ on: "message", from: "any" })
    expect(routineRun(any, batch(say("mine", agent("yuki")), say("loop", agent("ada", true))))).toBeNull()
    expect(routineRun(any, batch(say("hi", { kind: "human" }), say("read a page", agent("ada"))))).toEqual({ body: 'what happened:\n- the human wrote: "hi"\n- @ada wrote: "read a page"' })
    expect(routineRun(any, { ...batch(say("hi", { kind: "human" })), more: 3 })!.body.endsWith("- and more")).toBe(true)
  })

  test("a watch steps on its own grid past now, and a trigger reads as words", () => {
    expect(nextEvery(0, 10, 25)).toBe(30)
    expect(nextEvery(0, 10, 30)).toBe(40)
    expect(nextEvery(100, 10, 50)).toBe(110)
    const due = Date.UTC(2026, 9, 6, 6, 30)
    expect(describeTrigger({ on: "time", at: "x", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }, "Europe/Berlin", due)).toBe("every weekday, next tue, oct 6 at 08:30 (Europe/Berlin)")
    expect(describeTrigger({ on: "watch", url: "https://x.test", everyMinutes: 30 }, "UTC", due)).toBe("when https://x.test changes, checked every 30 minutes")
  })
})

describe("signal window", () => {
  test("a sent batch subtracts its overflow, so overflow that arrived in flight stays for the next window", () => {
    const window = new SignalWindow(sqlWith(ROOM_STEPS), () => "r1")
    const hit = (n: number): Signal => ({ kind: "burst", roomId: "r1", at: 1, seq: n, text: `t${n}`, by: { kind: "human" } })
    window.add(Array.from({ length: 25 }, (_, i) => hit(i)), 1)
    const due = window.due(1 + 60_001)!
    expect(due.batch.more).toBe(5)
    window.add([hit(100), hit(101), hit(102)], 2)
    window.sent(due.upto, due.batch.more)
    window.add([hit(103)], 3)
    const next = window.due(3 + 60_001)!
    expect(next.batch.signals.length).toBe(1)
    expect(next.batch.more).toBe(3)
  })
})
