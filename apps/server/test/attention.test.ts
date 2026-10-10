import { describe, expect, test } from "bun:test"
import { allowance, type Appetite, emptyAppetite, kindOpen, nudged, restUntil, settle } from "../src/initiative/attention/appetite"
import { type AttendContext, attend } from "../src/initiative/attention/attend"
import { emptyRhythm, ignoreDeadline, nextMoment, type Rhythm, record, slotOf, view } from "../src/initiative/attention/rhythm"
import { AttentionStore } from "../src/initiative/attention/store"
import type { Candidate, Signal } from "../src/initiative/attention/types"
import { sqlStorage } from "./sql-shim"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NY = "America/New_York"
// Monday 2026-09-07 00:00 in New York (UTC-4).
const MON = Date.UTC(2026, 8, 7, 4)

/** Messages at the given local hours on the given weekdays (0 = Monday), for `weeks` weeks. */
function habit(days: number[], hours: number[], weeks: number, start = MON): Rhythm {
  let r = emptyRhythm()
  for (let w = 0; w < weeks; w++) for (const d of days) for (const h of hours) r = record(r, start + w * 7 * DAY + d * DAY + h * HOUR + 10 * 60_000, NY)
  return r
}

const local = (at: number, tz = NY) => ({ day: Math.floor(slotOf(at, tz) / 24), hour: slotOf(at, tz) % 24 })

describe("rhythm", () => {
  const weekdays = habit([0, 1, 2, 3, 4], [9, 10, 11], 3)
  const after = MON + 21 * DAY

  test("the moment is the start of the usual window on the next active day", () => {
    // Tuesday 20:00: the next window opens Wednesday morning, just before 09:00.
    const m = nextMoment(weekdays, after + DAY + 20 * HOUR, NY)!
    expect(local(m).day).toBe(2)
    expect(local(m).hour).toBeGreaterThanOrEqual(8)
    expect(local(m).hour).toBeLessThanOrEqual(9)
    // Friday evening skips the weekend.
    expect(local(nextMoment(weekdays, after + 4 * DAY + 20 * HOUR, NY)!).day).toBe(0)
  })

  test("a cold start has no moment and is not known", () => {
    expect(nextMoment(emptyRhythm(), MON, NY)).toBeNull()
    expect(view(habit([0], [9], 1), MON + 7 * DAY, NY).known).toBe(false)
    expect(view(weekdays, after, NY).known).toBe(true)
  })

  test("a moment lands on a local hour in a half-hour zone", () => {
    let r = emptyRhythm()
    const ist = "Asia/Kolkata"
    for (let d = 0; d < 14; d++) r = record(r, Date.UTC(2026, 8, 7 + d, 3, 40), ist) // 09:10 IST
    const m = nextMoment(r, Date.UTC(2026, 8, 22, 12), ist)!
    expect(new Date(m).getUTCMinutes()).toBe(30)
    expect([8, 9]).toContain(local(m, ist).hour)
  })

  test("the ignore window follows the human's own pace", () => {
    const daily = habit([0, 1, 2, 3, 4, 5, 6], [9, 10, 11], 3)
    const sent = after + 12 * HOUR // Monday noon
    expect(ignoreDeadline(daily, sent, NY) - sent).toBeLessThan(2 * DAY)
    const weekend = habit([5, 6], [10, 11, 12, 13, 14], 3)
    // Someone who writes only on weekends is not "ignoring" a Monday nudge on Tuesday.
    expect(local(ignoreDeadline(weekend, sent, NY)).day).toBeGreaterThanOrEqual(5)
    expect(ignoreDeadline(emptyRhythm(), sent, NY)).toBe(sent + DAY)
  })
})

const pending = (id: string, at: number, kind: Candidate["kind"] = "intention") => ({ id, room: "r1", kind, loop: `loop-${id}`, at, deadline: at + DAY })

function ignoreN(app: Appetite, n: number, kind: Candidate["kind"] = "intention", start = 0): Appetite {
  let a = app
  for (let i = 0; i < n; i++) {
    const at = start + i * 2 * DAY
    a = settle(nudged(a, pending(`n${i}`, at, kind)), [], at + DAY + 1).appetite
  }
  return a
}

describe("appetite", () => {
  test("ignored twice: nudges drop to zero and rest grows faster than doubling", () => {
    const fresh = emptyAppetite()
    const once = ignoreN(fresh, 1)
    const twice = ignoreN(fresh, 2)
    expect([allowance(fresh, 0), allowance(once, 2 * DAY), allowance(twice, 4 * DAY)]).toEqual([1, 1, 0])
    const rest = (app: Appetite, ignored: number) => restUntil(app, { kind: "intention", lastSurfaced: 0, ignored }, DAY, 4 * DAY)
    expect(rest(fresh, 0)).toBe(DAY)
    expect(rest(once, 1)).toBeGreaterThan(2 * DAY)
    expect(rest(twice, 2)).toBeGreaterThan(2 * rest(once, 1))
  })

  test("time fades ignores and lets one careful nudge back", () => {
    expect(allowance(ignoreN(emptyAppetite(), 2), 4 * DAY + 60 * DAY)).toBe(1)
  })

  test("a reply in the nudge's room is engagement; a reply elsewhere is not", () => {
    const app = nudged(emptyAppetite(), pending("a", 0))
    const elsewhere = settle(app, [{ kind: "burst", id: "b1", room: "r2", at: HOUR, from: "human" }], 2 * HOUR)
    expect(elsewhere.outcomes).toEqual([])
    expect(elsewhere.appetite.pending).toHaveLength(1)
    const here = settle(app, [{ kind: "burst", id: "b2", room: "r1", at: HOUR, from: "human" }], 2 * HOUR)
    expect(here.outcomes.map((o) => o.result)).toEqual(["engaged"])
    expect(here.appetite.pending).toEqual([])
    // Three engagements earn a second nudge per pass.
    let keen = emptyAppetite()
    for (let i = 0; i < 3; i++) keen = settle(nudged(keen, pending(`k${i}`, i * DAY)), [{ kind: "burst", id: `kb${i}`, room: "r1", at: i * DAY + HOUR, from: "human" }], i * DAY + 2 * HOUR).appetite
    expect(allowance(keen, 3 * DAY)).toBe(2)
  })

  test("a dismissal beats the reply that carried it and closes only that kind", () => {
    const app = nudged(emptyAppetite(), pending("a", 0, "goal"))
    const signals: Signal[] = [
      { kind: "burst", id: "b", room: "r1", at: HOUR, from: "human" },
      { kind: "dismiss", id: "d", room: "r1", at: HOUR, nudge: "a" },
    ]
    const { appetite, outcomes } = settle(app, signals, 2 * HOUR)
    expect(outcomes.map((o) => o.result)).toEqual(["dismissed"])
    expect(kindOpen(appetite, "goal", 2 * HOUR)).toBe(false)
    expect(kindOpen(appetite, "waiting", 2 * HOUR)).toBe(true)
  })
})

const NOW = 100 * DAY
const known = { known: true, activeNow: true, moments: [NOW + DAY, NOW + 2 * DAY, NOW + 3 * DAY], cycle: DAY }

function cand(over: Partial<Candidate> = {}): Candidate {
  return { id: "c", kind: "intention", certainty: "explicit", owner: "human", room: "r1", due: NOW + 12 * HOUR, mentions: 1, lastSeen: NOW - DAY, surfaced: 0, ignored: 0, tainted: false, ...over }
}

function ctx(over: Partial<AttendContext> = {}): AttendContext {
  return { now: NOW, level: "active", away: false, budget: 10, busyRooms: [], leads: { r1: "yuki", r2: "yuki" }, rhythm: known, appetite: emptyAppetite(), ...over }
}

describe("attend", () => {
  const cases: [string, Partial<Candidate>, Partial<AttendContext>, string, string?][] = [
    ["due before the next moment, no Jev: the lead decides", {}, {}, "ask_lead", "r1/yuki"],
    ["an agent's own promise goes to that agent", { kind: "commitment", owner: "scout", due: undefined }, {}, "ask_lead", "r1/scout"],
    ["Jev says worth it", {}, { worthNow: { c: 0.9 } }, "nudge", "r1/yuki"],
    ["Jev says not now", {}, { worthNow: { c: 0.2 } }, "brief:worth"],
    ["initiative off", {}, { level: "off" }, "drop:off"],
    ["in chat only", {}, { level: "chat" }, "brief:quiet"],
    ["the human is typing in that room", {}, { busyRooms: ["r1"] }, "brief:typing"],
    ["typing in another room does not hold this one", {}, { busyRooms: ["r2"] }, "ask_lead", "r1/yuki"],
    ["cold start", {}, { rhythm: { known: false, activeNow: false, moments: [], cycle: DAY } }, "brief:cold"],
    ["away", {}, { away: true }, "brief:away"],
    ["no budget", {}, { budget: 0 }, "brief:budget"],
    ["tentative without Jev never interrupts", { certainty: "tentative" }, {}, "brief:tentative"],
    ["far due, mentioned long ago", { due: NOW + 30 * DAY, lastSeen: NOW - 60 * DAY, mentions: 1 }, {}, "brief:worth"],
    ["outside the usual window", {}, { rhythm: { ...known, activeNow: false } }, "brief:moment"],
    ["prep before the moment", { preparable: true }, { rhythm: { ...known, activeNow: false }, prepare: true, worthNow: { c: 0.9 } }, "prepare", "r1/yuki"],
    ["a tainted loop is never prepared", { preparable: true, tainted: true }, { rhythm: { ...known, activeNow: false }, prepare: true, worthNow: { c: 0.9 } }, "brief:moment"],
    ["no lead in the room", { room: "r9" }, {}, "brief:no_lead"],
    ["nudged an hour ago", { surfaced: 1, lastSurfaced: NOW - HOUR }, {}, "rest"],
    ["two ignores of the kind", {}, { appetite: ignoreN(emptyAppetite(), 2, "intention", NOW - 4 * DAY) }, "brief:appetite"],
    ["dismissed kind", { kind: "goal" }, { appetite: settle(nudged(emptyAppetite(), pending("x", NOW - DAY, "goal")), [{ kind: "dismiss", id: "d", room: "r1", at: NOW - HOUR, nudge: "x" }], NOW).appetite }, "brief:appetite"],
  ]

  for (const [name, c, x, want, target] of cases) {
    test(name, () => {
      const [v] = attend([cand(c)], ctx(x))
      const got = v!.verdict === "drop" || v!.verdict === "brief" ? `${v!.verdict}${v!.reason ? `:${v!.reason}` : ""}` : v!.verdict
      expect(got).toBe(want)
      if (target) expect("target" in v! ? `${v.target.room}/${v.target.slug}` : "").toBe(target)
    })
  }

  test("rest after an ignore lasts longer than after a clean nudge", () => {
    const at = (ignored: number) => {
      const [v] = attend([cand({ surfaced: 1, lastSurfaced: NOW - HOUR, ignored })], ctx())
      return v!.verdict === "rest" ? v!.until : 0
    }
    expect(at(1)).toBeGreaterThan(at(0))
  })

  test("one interruption per room, the most worthwhile wins", () => {
    const vs = attend([cand({ id: "weak", due: NOW + 2.5 * DAY, mentions: 3, lastSeen: NOW }), cand({ id: "strong", due: NOW - HOUR })], ctx({ appetite: keenAppetite() }))
    expect(vs.map((v) => (v.verdict === "brief" ? `brief:${v.reason}` : v.verdict))).toEqual(["brief:room_taken", "ask_lead"])
  })

  test("the appetite caps interruptions across rooms; digest allows one", () => {
    const two = [cand({ id: "a", room: "r1" }), cand({ id: "b", room: "r2" })]
    const count = (x: Partial<AttendContext>) => attend(two, ctx(x)).filter((v) => v.verdict === "ask_lead").length
    expect(count({})).toBe(1)
    expect(count({ appetite: keenAppetite() })).toBe(2)
    expect(count({ appetite: keenAppetite(), level: "digest" })).toBe(1)
    expect(count({ appetite: ignoreN(emptyAppetite(), 2, "waiting", NOW - 4 * DAY) })).toBe(0)
  })
})

function keenAppetite(): Appetite {
  let a = emptyAppetite()
  for (let i = 0; i < 4; i++) {
    const at = NOW - 10 * DAY + i * DAY
    a = settle(nudged(a, pending(`k${i}`, at)), [{ kind: "burst", id: `kb${i}`, room: "r1", at: at + HOUR, from: "human" }], at + 2 * HOUR).appetite
  }
  return a
}

describe("store", () => {
  test("a redelivered batch counts once, and outcomes survive a new object", () => {
    const sql = sqlStorage()
    const store = new AttentionStore(sql)
    const batch: Signal[] = Array.from({ length: 12 }, (_, i) => ({ kind: "burst", id: `b${i}`, room: "r1", at: MON + i * DAY + 9 * HOUR, from: "human" }))
    store.observe(batch, MON + 12 * DAY, NY)
    const once = store.rhythm().w.reduce((a, b) => a + b, 0)
    store.observe(batch, MON + 12 * DAY, NY)
    expect(store.rhythm().w.reduce((a, b) => a + b, 0)).toBe(once)
    expect(view(store.rhythm(), MON + 12 * DAY, NY).known).toBe(true)

    store.sent({ id: "n1", room: "r2", kind: "waiting", loop: "l1", at: MON + 12 * DAY }, NY)
    store.sent({ id: "n1", room: "r2", kind: "waiting", loop: "l1", at: MON + 12 * DAY }, NY)
    const again = new AttentionStore(sql)
    expect(again.appetite().pending).toHaveLength(1)
    const outcomes = again.observe([], MON + 20 * DAY, NY)
    expect(outcomes.map((o) => `${o.nudge.loop}:${o.result}`)).toEqual(["l1:ignored"])
    expect(again.appetite().pending).toEqual([])
  })
})
