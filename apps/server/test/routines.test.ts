import { describe, expect, test } from "bun:test"
import type { AgentSlug, Envelope, RoomEvent } from "@kiko/protocol"
import { Trigger } from "@kiko/protocol/schema"
import { Schema } from "effect"
import { gate, NO_CARD, needsApproval } from "@kiko/agent/trust"
import { AUTO, authorityOf, authorityOfAll, combine, HUMAN } from "@kiko/agent/authority"
import { eventLine, matches } from "../src/room/routines"
import { nextSweep, stalled, STALE_MS, SWEEP_MS } from "../src/room/stalls"
import { DEFAULT_LIMITS, takeAutonomous } from "../src/user/limits"
import { describeTrigger, nextEvery, runGrant } from "../src/user/reminders"
import { matchWebhook, type RoomRoutine } from "../src/user/routines"

// Architecture section 25. The pure rules routines and proactivity stand on.

const routine = (grant: string[]) => ({ origin: "routine" as const, grant })
const env = (e: Partial<Envelope>): Pick<Envelope, "from" | "origin" | "grant"> => ({ from: { kind: "system", reason: "routine" }, ...e })

describe("authority (section 25.3)", () => {
  test("a stored envelope without an origin is the human's only when a human wrote it", () => {
    expect(authorityOf(env({ from: { kind: "human" } }))).toEqual(HUMAN)
    expect(authorityOf(env({ from: { kind: "agent", slug: "ada" as AgentSlug } }))).toEqual(AUTO)
    expect(authorityOf(env({}))).toEqual(AUTO)
    expect(authorityOf(env({ origin: "routine", grant: ["send_email"] }))).toEqual(routine(["send_email"]))
    // A grant on anything but a routine means nothing.
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
  // [effect, tainted, card, authority, tool, runs]. Who started the run decides an outside call; taint
  // only flags writes and messages. Each row fails if its rule breaks.
  const table: [Parameters<typeof gate>[0], boolean, string | null, ReturnType<typeof combine>, string, boolean][] = [
    ["external", false, null, HUMAN, "send", true],
    ["external", true, null, HUMAN, "send", true], // DEVIATION: a tainted run the human started needs no card
    ["external", false, null, routine(["send"]), "send", true],
    ["external", true, null, routine(["send"]), "send", true], // a routine's grant holds when its run is tainted
    ["external", false, null, routine(["send"]), "delete", false],
    ["external", true, null, routine(["send"]), "delete", false],
    ["external", false, null, AUTO, "send", false],
    ["external", true, null, AUTO, "send", false],
    ["external", true, "ap_1", AUTO, "send", true], // an accepted card, or a live grant
    ["external", false, "ap_1", routine([]), "send", true],
    ["read", true, null, AUTO, "x", true],
    ["write", true, null, AUTO, "x", true],
    ["message", true, null, AUTO, "x", true],
  ]
  for (const [effect, tainted, card, authority, tool, runs] of table) {
    test(`${effect} ${tool} in a ${tainted ? "tainted" : "clean"} ${authority.origin} run${card ? " with a card" : ""} ${runs ? "runs" : "waits"}`, () => {
      expect(gate(effect, tainted, card, authority, tool).allow).toBe(runs)
      // The card is asked for exactly when the call would otherwise wait.
      if (effect === "external" && !card) expect(needsApproval(authority, tool)).toBe(!runs)
    })
  }

  test("a routine a tainted run made runs with no grant; one a clean run or the human's card made keeps it", () => {
    expect(runGrant({ tainted: false, grant: ["send"] })).toEqual(["send"])
    expect(runGrant({ tainted: true, grant: ["send"] })).toEqual([])
  })

  test("taint flags writes and messages; a call that waits says why", () => {
    expect(gate("write", true, null, HUMAN, "x")).toEqual({ allow: true, flagTainted: true })
    expect(gate("message", false, null, AUTO, "x")).toEqual({ allow: true, flagTainted: false })
    expect(gate("external", false, null, AUTO, "send")).toEqual({ allow: false, reason: NO_CARD })
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

  test("room events match by kind, status, sender, text, and path prefix", () => {
    const name = (s: AgentSlug) => s as string
    const at = { seq: 1, at: 0 }
    const task = eventLine({ ...at, t: "task", task: { id: "t", title: "ship", status: "review", dependsOn: [] } } as RoomEvent, name)!
    const human = eventLine({ ...at, t: "message", id: "m", from: { kind: "human" }, text: "Deploy it" } as RoomEvent, name)!
    const file = eventLine({ ...at, t: "file", file: { id: "f", name: "reports/q3.md", size: 1, type: "text/markdown" } } as RoomEvent, name)!
    const r = (trigger: RoomRoutine["trigger"]): RoomRoutine => ({ id: "r", target: "kiko", trigger })
    expect(matches(r({ on: "task", status: ["review"] }), task)).toBe(true)
    expect(matches(r({ on: "task", status: ["done"] }), task)).toBe(false)
    expect(matches(r({ on: "task" }), task)).toBe(true)
    expect(matches(r({ on: "message", from: "human", contains: "deploy" }), human)).toBe(true)
    expect(matches(r({ on: "message", from: "agent" }), human)).toBe(false)
    expect(matches(r({ on: "file", path: "/reports/" }), file)).toBe(true)
    expect(matches(r({ on: "file", path: "report" }), file)).toBe(false)
    expect(eventLine({ ...at, t: "message", id: "m", from: { kind: "system", reason: "reminder" }, text: "x" } as RoomEvent, name)).toBeNull()
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
    // Never seen (an account from before the stamp) is not away.
    expect(takeAutonomous(0, null, limits, now)).toEqual({ ok: true, used: 1 })
  })

  test("a stale task nudges its owner, review work nudges the lead, fresh or unowned work nobody", () => {
    const now = 10 * STALE_MS
    const old = now - STALE_MS - 1
    const rows = [
      { id: "a", title: "a", status: "doing", owner: "ada", updated_at: old },
      { id: "b", title: "b", status: "review", owner: "ada", updated_at: old },
      { id: "c", title: "c", status: "doing", owner: "ada", updated_at: now - 1000 },
      { id: "d", title: "d", status: "todo", owner: "ada", updated_at: old },
      { id: "e", title: "e", status: "blocked", owner: null, updated_at: old },
    ]
    expect(stalled(rows, "kiko" as AgentSlug, now, () => false).map((n) => [n.taskId, n.to])).toEqual([
      ["a", "ada"],
      ["b", "kiko"],
    ])
    // Nudged once for this stretch: not again until the task changes.
    expect(stalled(rows, "kiko" as AgentSlug, now, (id) => id === `stalled:a:${old}`).map((n) => n.taskId)).toEqual(["b"])
  })
})

test("the stall sweep sleeps until the first unnudged task goes stale, and not at all for todo work or work already nudged", () => {
  const now = Date.UTC(2026, 9, 5, 12)
  const row = (updated_at: number, status = "doing") => ({ id: "a", title: "a", status, owner: "ada", updated_at })
  const never = () => false
  expect(nextSweep([], now, never)).toBeNull()
  expect(nextSweep([row(now - 1000, "todo")], now, never)).toBeNull()
  expect(nextSweep([row(now - 1000)], now, never)).toBe(now - 1000 + STALE_MS)
  expect(nextSweep([row(now - STALE_MS + 60_000)], now, never)).toBe(now + SWEEP_MS)
  expect(nextSweep([row(now - STALE_MS - 1)], now, () => true)).toBeNull()
})
