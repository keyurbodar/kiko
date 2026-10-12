import { describe, expect, test } from "bun:test"
import { allowance, type Appetite, emptyAppetite, kindOpen, learn, nudged, restUntil, settle } from "../src/initiative/attention/appetite"
import { type AttendContext, attend, rankOrder, score } from "../src/initiative/attention/attend"
import { emptyRhythm, ignoreDeadline, nextMoment, type Rhythm, record, slotOf, view } from "../src/initiative/attention/rhythm"
import { AttentionStore } from "../src/initiative/attention/store"
import type { Candidate, Signal } from "../src/initiative/attention/types"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NY = "America/New_York"
const MON = Date.UTC(2026, 8, 7, 4)

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
    const m = nextMoment(weekdays, after + DAY + 20 * HOUR, NY)!
    expect(local(m).day).toBe(2)
    expect(local(m).hour).toBeGreaterThanOrEqual(8)
    expect(local(m).hour).toBeLessThanOrEqual(9)
    expect(local(nextMoment(weekdays, after + 4 * DAY + 20 * HOUR, NY)!).day).toBe(0)
  })

  test("a moment is the session's own hour, not the hour before it", () => {
    const nine = habit([0, 1, 2, 3, 4], [9], 3)
    expect(local(nextMoment(nine, after + DAY + 20 * HOUR, NY)!).hour).toBe(9)
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
  test("ignored twice: nudges drop to zero and rest doubles with each ignore", () => {
    const fresh = emptyAppetite()
    const once = ignoreN(fresh, 1)
    const twice = ignoreN(fresh, 2)
    expect([allowance(fresh, 0), allowance(once, 2 * DAY), allowance(twice, 4 * DAY)]).toEqual([1, 1, 0])
    const rest = (ignored: number) => restUntil({ lastSurfaced: 0, ignored }, DAY)
    expect([rest(0), rest(1), rest(2)]).toEqual([DAY, 2 * DAY, 4 * DAY])
  })

  test("a loop ignored ten times rests eight cycles at most, however closed its kind is", () => {
    let closed = emptyAppetite()
    for (let i = 0; i < 60; i++) closed = learn(closed, "intention", "ignored", 0)
    expect(kindOpen(closed, "intention", 0)).toBe(false)
    expect(restUntil({ lastSurfaced: 0, ignored: 10 }, DAY)).toBe(8 * DAY)
  })

  test("time fades ignores and lets one careful nudge back", () => {
    expect(allowance(ignoreN(emptyAppetite(), 2), 4 * DAY + 60 * DAY)).toBe(1)
  })

  test("an answer to the nudge is engagement at the deadline; talking in its chat anyway is not", () => {
    const app = nudged(emptyAppetite(), pending("a", 0))
    const chatting = settle(app, [{ kind: "burst", id: "b1", room: "r1", at: HOUR }, { kind: "answer", id: "a0", room: "r1", at: HOUR, loop: "loop-other" }], 2 * DAY)
    expect(chatting.outcomes.map((o) => o.result)).toEqual(["ignored"])
    const noted = settle(app, [{ kind: "answer", id: "a1", room: "r1", at: HOUR, loop: "loop-a" }], 2 * HOUR)
    expect(noted.outcomes).toEqual([])
    expect(noted.appetite.pending[0]?.engaged).toBe(HOUR)
    const here = settle(noted.appetite, [], 2 * DAY)
    expect(here.outcomes.map((o) => `${o.result}@${o.at}`)).toEqual([`engaged@${HOUR}`])
    expect(here.appetite.pending).toEqual([])
    let keen = emptyAppetite()
    for (let i = 0; i < 3; i++) keen = settle(nudged(keen, pending(`k${i}`, i * DAY)), [{ kind: "answer", id: `ka${i}`, room: "r1", at: i * DAY + HOUR, loop: `loop-k${i}` }], i * DAY + DAY).appetite
    expect(allowance(keen, 3 * DAY)).toBe(2)
  })

  test("a drop wins over the reply that carried it, in either order, and closes only that kind", () => {
    const app = nudged(emptyAppetite(), pending("a", 0, "goal"))
    const reply: Signal = { kind: "answer", id: "b", room: "r1", at: HOUR, loop: "loop-a" }
    const drop: Signal = { kind: "dismiss", id: "d", room: "r1", at: HOUR + 60_000, loop: "loop-a" }
    const together = settle(app, [reply, drop], 2 * HOUR)
    const first = settle(app, [reply], HOUR + 1)
    const later = settle(first.appetite, [drop], 2 * HOUR)
    for (const { appetite, outcomes } of [together, { appetite: later.appetite, outcomes: [...first.outcomes, ...later.outcomes] }]) {
      expect(outcomes.map((o) => o.result)).toEqual(["dismissed"])
      expect(kindOpen(appetite, "goal", 2 * HOUR)).toBe(false)
      expect(kindOpen(appetite, "waiting", 2 * HOUR)).toBe(true)
    }
  })

  test("a [skip] teaches the kind, never the human's allowance", () => {
    const skips = (n: number) => {
      let a = emptyAppetite()
      for (let i = 0; i < n; i++) a = learn(a, "intention", "skipped", i * DAY)
      return a
    }
    expect(kindOpen(skips(1), "intention", DAY)).toBe(true)
    expect(kindOpen(skips(2), "intention", 2 * DAY)).toBe(false)
    expect(kindOpen(skips(2), "waiting", 2 * DAY)).toBe(true)
    expect(allowance(skips(2), 2 * DAY)).toBe(1)
  })
})

const NOW = 100 * DAY
const known = { known: true, activeNow: true, moments: [NOW + DAY, NOW + 2 * DAY, NOW + 3 * DAY], cycle: DAY }

function cand(over: Partial<Candidate> = {}): Candidate {
  return { id: "c", kind: "intention", certainty: "explicit", owner: "human", room: "r1", due: NOW + 12 * HOUR, lastSeen: NOW - DAY, surfaced: 0, ignored: 0, ...over }
}

function ctx(over: Partial<AttendContext> = {}): AttendContext {
  return { now: NOW, level: "active", away: false, busyRooms: [], leads: { r1: "yuki", r2: "yuki" }, rhythm: known, appetite: emptyAppetite(), ...over }
}

describe("attend", () => {
  const cases: [string, Partial<Candidate>, Partial<AttendContext>, string, string?][] = [
    ["due before the next moment, no Jev: the score decides", {}, {}, "nudge", "r1/yuki"],
    ["an agent's own promise goes to that agent", { kind: "commitment", owner: "scout", due: undefined }, {}, "nudge", "r1/scout"],
    ["Jev says worth it", {}, { worthNow: { c: 0.9 } }, "nudge", "r1/yuki"],
    ["Jev says not now", {}, { worthNow: { c: 0.2 } }, "brief:worth"],
    ["Jev answered but did not read it", {}, { worthNow: { other: 0.9 } }, "brief:worth"],
    ["initiative off", {}, { level: "off" }, "brief:off"],
    ["in chat only", {}, { level: "chat" }, "brief:quiet"],
    ["the human wrote in that room moments ago", {}, { busyRooms: ["r1"] }, "brief:typing"],
    ["writing in another room does not hold this one", {}, { busyRooms: ["r2"] }, "nudge", "r1/yuki"],
    ["cold start", {}, { rhythm: { known: false, activeNow: false, moments: [], cycle: DAY } }, "brief:cold"],
    ["away", {}, { away: true }, "brief:away"],
    ["tentative without Jev never interrupts", { certainty: "tentative" }, {}, "brief:tentative"],
    ["far due, seen long ago", { due: NOW + 30 * DAY, lastSeen: NOW - 60 * DAY }, {}, "brief:worth"],
    ["outside the usual window", {}, { rhythm: { ...known, activeNow: false } }, "brief:moment"],
    ["no lead in the room", { room: "r9" }, {}, "brief:no_lead"],
    ["said an hour ago, not due yet", { lastSeen: NOW - HOUR }, {}, "brief:fresh"],
    ["promised an hour ago, due a week out", { kind: "commitment", owner: "scout", lastSeen: NOW - 2 * DAY, due: NOW + 7 * DAY }, {}, "brief:worth"],
    ["nudged an hour ago", { surfaced: 1, lastSurfaced: NOW - HOUR }, {}, "rest"],
    ["two ignores of the kind", {}, { appetite: ignoreN(emptyAppetite(), 2, "intention", NOW - 4 * DAY) }, "brief:appetite"],
    ["Jev says worth it for a kind the appetite has closed", {}, { appetite: skipped(2), worthNow: { c: 0.9 } }, "nudge", "r1/yuki"],
    ["no Jev: the score alone decides, not the kind's welcome", { due: NOW + 2 * DAY }, { appetite: halfWelcome() }, "nudge", "r1/yuki"],
    ["dismissed kind", { kind: "goal" }, { appetite: settle(nudged(emptyAppetite(), pending("x", NOW - DAY, "goal")), [{ kind: "dismiss", id: "d", room: "r1", at: NOW - HOUR, loop: "loop-x" }], NOW).appetite }, "brief:appetite"],
  ]

  for (const [name, c, x, want, target] of cases) {
    test(name, () => {
      const [v] = attend([cand(c)], ctx(x))
      const got = v!.verdict === "brief" ? `brief:${v!.reason}` : v!.verdict
      expect(got).toBe(want)
      if (target) expect("target" in v! ? `${v.target.room}/${v.target.slug}` : "").toBe(target)
    })
  }

  test("nothing due or promised scores zero, however long ago it was said", () => {
    const scores = [
      cand({ due: undefined, lastSeen: NOW - HOUR }),
      cand({ due: undefined, lastSeen: NOW - 60 * DAY }),
      cand({ kind: "goal", due: undefined, lastSeen: NOW - 60 * DAY }),
    ].map((c) => score(c, { now: NOW, rhythm: known }))
    expect(scores).toEqual([0, 0, 0])
  })

  test("an agent's promise with no date scores half", () => {
    expect(score(cand({ kind: "commitment", owner: "scout", due: undefined }), { now: NOW, rhythm: known })).toBe(0.5)
  })

  test("equal scores rank the oldest sighting first", () => {
    const recent = cand({ id: "recent", due: undefined, lastSeen: NOW - HOUR })
    const old = cand({ id: "old", due: undefined, lastSeen: NOW - 30 * DAY })
    const order = [recent, old].sort(rankOrder({ now: NOW, rhythm: known }))
    expect(order.map((c) => c.id)).toEqual(["old", "recent"])
  })

  test("rest after an ignore lasts longer than after a clean nudge", () => {
    const at = (ignored: number) => {
      const [v] = attend([cand({ surfaced: 1, lastSurfaced: NOW - HOUR, ignored })], ctx())
      return v!.verdict === "rest" ? v!.until : 0
    }
    expect(at(1)).toBeGreaterThan(at(0))
  })

  test("one interruption per room, the most worthwhile wins", () => {
    const vs = attend([cand({ id: "weak", due: NOW + 1.5 * DAY, lastSeen: NOW - DAY }), cand({ id: "strong", due: NOW - HOUR })], ctx({ appetite: keenAppetite() }))
    expect(vs.map((v) => (v.verdict === "brief" ? `brief:${v.reason}` : v.verdict))).toEqual(["brief:room_taken", "nudge"])
  })

  test("the appetite caps interruptions across rooms; digest allows one", () => {
    const two = [cand({ id: "a", room: "r1" }), cand({ id: "b", room: "r2" })]
    const count = (x: Partial<AttendContext>) => attend(two, ctx(x)).filter((v) => v.verdict === "nudge").length
    expect(count({})).toBe(1)
    expect(count({ appetite: keenAppetite() })).toBe(2)
    expect(count({ appetite: keenAppetite(), level: "digest" })).toBe(1)
    expect(count({ appetite: ignoreN(emptyAppetite(), 2, "waiting", NOW - 4 * DAY) })).toBe(0)
  })
})

// Two skips of intentions in the last two days: the kind is closed, the user's allowance is open.
function skipped(n: number): Appetite {
  let a = emptyAppetite()
  for (let i = 0; i < n; i++) a = learn(a, "intention", "skipped", NOW - (n - i) * DAY)
  return a
}

// One engagement and two ignores of intentions a day ago: the kind's welcome is 0.4 and still open.
function halfWelcome(): Appetite {
  const a = learn(emptyAppetite(), "intention", "engaged", NOW - DAY)
  return learn(learn(a, "intention", "ignored", NOW - DAY), "intention", "ignored", NOW - DAY)
}

function keenAppetite(): Appetite {
  let a = emptyAppetite()
  for (let i = 0; i < 4; i++) {
    const at = NOW - 10 * DAY + i * DAY
    a = settle(nudged(a, pending(`k${i}`, at)), [{ kind: "answer", id: `ka${i}`, room: "r1", at: at + HOUR, loop: `loop-k${i}` }], at + DAY).appetite
  }
  return a
}

describe("store", () => {
  test("a redelivered batch counts once, and outcomes survive a new object", () => {
    const sql = sqlWith(USER_STEPS)
    const store = new AttentionStore(sql)
    const batch: Signal[] = Array.from({ length: 12 }, (_, i) => ({ kind: "burst", id: `b${i}`, room: "r1", at: MON + i * DAY + 9 * HOUR }))
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
