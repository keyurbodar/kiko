import { describe, expect, test } from "bun:test"
import type { AgentSlug, RoomEvent } from "@kiko/protocol"
import { Trigger } from "@kiko/protocol/schema"
import { Schema } from "effect"
import { matches, routineRun, Signal, signalOf } from "../src/room/routine-events"
import { sqlWith } from "./sql-shim"
import { ROOM_STEPS } from "../src/room/schema"
import { parseTrigger } from "../src/agent/extensions/routines"
import { describeTrigger } from "../src/user/reminders"
import { matchWebhook, type RoomRoutine } from "../src/user/routines"

describe("triggers", () => {
  const decode = Schema.decodeUnknownSync(Trigger)

  test("the schema takes time, message, and webhook, and refuses the cut triggers or too many conditions", () => {
    expect(() => decode({ on: "time", at: "2026-10-06T08:00:00+02:00", rrule: "FREQ=DAILY" })).not.toThrow()
    expect(() => decode({ on: "message", contains: "deploy" })).not.toThrow()
    expect(() => decode({ on: "watch", url: "https://example.com", everyMinutes: 15 })).toThrow()
    expect(() => decode({ on: "task", status: ["review"] })).toThrow()
    expect(() => decode({ on: "file", path: "invoices" })).toThrow()
    expect(() => decode({ on: "webhook", match: Array.from({ length: 9 }, () => ({ path: "a", equals: 1 })) })).toThrow()
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
  const r = (trigger: RoomRoutine["trigger"]): RoomRoutine => ({ id: "r", target: "kiko", trigger })

  test("the routine tools refuse a cut trigger with a line the model can fix, and take a one-time reminder in seconds", () => {
    for (const cut of [{ on: "watch", url: "https://example.com", everyMinutes: 15 }, { on: "task" }, { on: "file", path: "x" }]) {
      expect(parseTrigger(cut)).toMatch(/^bad trigger: .*shapes: \{on:'time'/)
    }
    expect(parseTrigger('{"on":"message"}')).toEqual({ on: "message" })
    const soon = parseTrigger({ on: "time", in_seconds: 600 })
    expect(soon).toMatchObject({ on: "time" })
    expect(Date.parse((soon as { at: string }).at) - Date.now()).toBeGreaterThan(590_000)
  })

  test("a message routine matches human text only", () => {
    const human = signalOf({ ...at, t: "message", id: "m", from: { kind: "human" }, text: "Deploy it" } as RoomEvent, ctx)!
    expect(signalOf({ ...at, t: "task", task: { id: "t", title: "ship", status: "review", dependsOn: [] } } as RoomEvent, ctx)).toBeNull()
    expect(matches(r({ on: "message", contains: "deploy" }), human)).toBe(true)
    expect(matches(r({ on: "message", contains: "ship" }), human)).toBe(false)
    expect(signalOf({ ...at, t: "message", id: "m", from: { kind: "system", reason: "reminder" }, text: "x" } as RoomEvent, ctx)).toBeNull()
  })

  test("a batch fires a routine once, never for its own agent's acts or a run an event started", () => {
    const say = (text: string, by: Parameters<typeof signalOf>[1]["by"]) => signalOf({ ...at, t: "message", id: "m", from: by?.kind === "agent" ? { kind: "agent", slug: by.slug } : { kind: "human" }, text } as RoomEvent, { ...ctx, by })!
    const agent = (slug: string, eventRun = false) => ({ kind: "agent" as const, slug, name: slug, eventRun })
    const batch = (...signals: Signal[]) => ({ roomId: "r1", openedAt: 0, signals, more: 0 })
    const any = r({ on: "message" })
    expect(routineRun(any, batch(say("mine", agent("kiko")), say("loop", agent("ada", true))))).toBeNull()
    expect(routineRun(any, batch(say("hi", { kind: "human" }), say("read a page", agent("ada"))))).toEqual({ body: 'what happened:\n- the human wrote: "hi"' })
    expect(routineRun(any, batch(say("only an agent spoke", agent("ada"))))).toBeNull()
    const stored = r({ on: "message", from: "agent" } as never)
    expect(routineRun(stored, batch(say("hi", { kind: "human" }), say("from ada", agent("ada"))))).toEqual({ body: 'what happened:\n- the human wrote: "hi"' })
    expect(routineRun(any, { ...batch(say("hi", { kind: "human" })), more: 3 })!.body.endsWith("- and more")).toBe(true)
  })

  test("a trigger reads as words", () => {
    const due = Date.UTC(2026, 9, 6, 6, 30)
    expect(describeTrigger({ on: "time", at: "x", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }, "Europe/Berlin", due)).toBe("every weekday, next tue, oct 6 at 08:30 (Europe/Berlin)")
    expect(describeTrigger({ on: "time", at: "x" }, "UTC", due)).toBe("once, tue, oct 6 at 06:30 (UTC)")
  })
})

