import { describe, expect, test } from "bun:test"
import type { AgentSlug, Envelope, RoomEvent } from "@yuki/protocol"
import { Trigger } from "@yuki/protocol/schema"
import { Schema } from "effect"
import { ASK_FIRST, gate } from "@yuki/agent/trust"
import { AUTO, authorityOf, authorityOfAll, combine, HUMAN } from "@yuki/agent/authority"
import { matches, routineRun, type Signal, signalOf } from "../src/room/signals"
import { DEFAULT_LIMITS, takeAutonomous } from "../src/user/limits"
import { describeTrigger, nextEvery, runGrant } from "../src/user/reminders"
import { matchWebhook, type RoomRoutine } from "../src/user/routines"

const routine = (grant: string[]) => ({ origin: "routine" as const, grant })
const env = (e: Partial<Envelope>): Pick<Envelope, "from" | "origin" | "grant"> => ({ from: { kind: "system", reason: "routine" }, ...e })

describe("authority (section 25.3)", () => {
  test("a stored envelope without an origin is the human's only when a human wrote it", () => {
    expect(authorityOf(env({ from: { kind: "human" } }))).toEqual(HUMAN)
    expect(authorityOf(env({ from: { kind: "agent", slug: "ada" as AgentSlug } }))).toEqual(AUTO)
    expect(authorityOf(env({}))).toEqual(AUTO)
    expect(authorityOf(env({ origin: "routine", grant: ["send_email"] }))).toEqual(routine(["send_email"]))
    expect(authorityOf(env({ origin: "auto", grant: ["send_email"] }))).toEqual(AUTO)
  })

  test("a human anywhere wins; otherwise the stricter wins and grants intersect", () => {
    const cases: [Parameters<typeof combine>[0], Parameters<typeof combine>[1], ReturnType<typeof combine>][] = [
      [null, routine(["a"]), routine(["a"])],
      [routine(["a"]), HUMAN, HUMAN],
      [HUMAN, AUTO, HUMAN],
      [routine(["a", "b"]), AUTO, AUTO],
      [routine(["a", "b"]), routine(["b", "c"]), routine(["b"])],
    ]
    for (const [a, b, out] of cases) expect(combine(a, b)).toEqual(out)
    expect(authorityOfAll([])).toBeNull()
    expect(authorityOfAll([env({ origin: "routine", grant: ["x"] }), env({ from: { kind: "human" } })])).toEqual(HUMAN)
  })
})

describe("the gate (sections 16.3 and 25.3)", () => {
  const table: [Parameters<typeof gate>[0], boolean, ReturnType<typeof combine>, string, boolean][] = [
    ["external", false, HUMAN, "send", true],
    ["external", true, HUMAN, "send", false],
    ["external", false, routine(["send"]), "send", true],
    ["external", true, routine(["send"]), "send", true],
    ["external", true, routine(["send"]), "delete", false],
    ["external", false, routine(["send"]), "delete", false],
    ["external", false, AUTO, "send", false],
    ["external", true, AUTO, "send", false],
    ["read", true, AUTO, "x", true],
    ["write", true, AUTO, "x", true],
    ["message", true, AUTO, "x", true],
  ]
  for (const [effect, tainted, authority, tool, runs] of table) {
    test(`${effect} ${tool} in a ${tainted ? "tainted" : "clean"} ${authority.origin} run ${runs ? "runs" : "asks"}`, () => {
      expect(gate(effect, tainted, authority, tool).allow).toBe(runs)
    })
  }

  test("a routine a tainted run made runs with no grant; one a clean run made keeps it", () => {
    expect(runGrant({ tainted: false, grant: ["send"] })).toEqual(["send"])
    expect(runGrant({ tainted: true, grant: ["send"] })).toEqual([])
  })

  test("taint flags writes and messages; a refused call tells the agent to ask in chat", () => {
    expect(gate("write", true, HUMAN, "x")).toEqual({ allow: true, flagTainted: true })
    expect(gate("message", false, AUTO, "x")).toEqual({ allow: true, flagTainted: false })
    expect(gate("external", false, AUTO, "send")).toEqual({ allow: false, reason: ASK_FIRST })
  })
})

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

  const ctx = { roomId: "r1", at: 0, by: { kind: "human" } as const, tainted: false }
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

  test("a batch fires a routine once, never for its own agent's acts or a run an event started, tainted when any act it lists is", () => {
    const say = (text: string, by: Parameters<typeof signalOf>[1]["by"], tainted = false) => signalOf({ ...at, t: "message", id: "m", from: by?.kind === "agent" ? { kind: "agent", slug: by.slug } : { kind: "human" }, text } as RoomEvent, { ...ctx, by, tainted })!
    const agent = (slug: string, eventRun = false) => ({ kind: "agent" as const, slug, name: slug, eventRun })
    const batch = (...signals: Signal[]) => ({ roomId: "r1", openedAt: 0, signals, more: 0 })
    const any = r({ on: "message", from: "any" })
    expect(routineRun(any, batch(say("mine", agent("yuki")), say("loop", agent("ada", true))))).toBeNull()
    expect(routineRun(any, batch(say("hi", { kind: "human" }), say("read a page", agent("ada"), true)))).toEqual({ body: 'what happened:\n- the human wrote: "hi"\n- @ada wrote: "read a page"', tainted: true })
    expect(routineRun(any, batch(say("hi", { kind: "human" })))!.tainted).toBe(false)
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

describe("proactivity (sections 25.5 and 25.6)", () => {
  test("runs nobody asked for stop at the day's limit, and while the human is away", () => {
    const now = Date.UTC(2026, 9, 5, 12)
    const limits = { ...DEFAULT_LIMITS, autonomousRunsPerDay: 2, awayDays: 7 }
    expect(takeAutonomous(0, now - 3_600_000, limits, now)).toEqual({ ok: true, used: 1 })
    expect(takeAutonomous(2, now, limits, now)).toEqual({ ok: false, reason: "limit" })
    expect(takeAutonomous(0, now - 8 * 86_400_000, limits, now)).toEqual({ ok: false, reason: "away" })
    expect(takeAutonomous(0, null, limits, now)).toEqual({ ok: true, used: 1 })
  })
})

