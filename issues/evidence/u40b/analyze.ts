// Closed-loop: run each variant as the decider and compare its nudges with the shipped model's.
// Open-loop: on the shipped trajectory, ask each simpler part what it would have decided at the same pass.
import { attend, score } from "../../../apps/server/src/initiative/attention/attend"
import * as AP from "../../../apps/server/src/initiative/attention/appetite"
import * as RH from "../../../apps/server/src/initiative/attention/rhythm"
import { BASE, DAY, HOUR, PERSONAS, type Persona, type Result, run, simple, START, TZ, type Variant } from "./sim"

const SEEDS = Number(process.env.SEEDS ?? 10)
const WEEKS = Number(process.env.WEEKS ?? 8)
const ROOMS = Number(process.env.ROOMS ?? 3)
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-")

const key = (n: { id: string; at: number }) => `${n.id.split("#")[0]}@${Math.floor((n.at - START) / DAY)}`
function compare(a: Result, b: Result) {
  const A = new Map(a.nudges.map((n) => [key(n), n.at]))
  const B = new Map(b.nudges.map((n) => [key(n), n.at]))
  let only = 0
  let extra = 0
  let moved = 0
  for (const [k, t] of A) {
    const u = B.get(k)
    if (u === undefined) only++
    else if (Math.abs(u - t) > HOUR) moved++
  }
  for (const k of B.keys()) if (!A.has(k)) extra++
  return { base: A.size, only, extra, moved }
}
const quality = (r: Result) => ({ n: r.nudges.length, welcome: r.nudges.filter((n) => n.intent === "reply").length, soon: r.nudges.filter((n) => (n.wait ?? Infinity) <= HOUR).length })

function closedLoop(title: string, base: Variant, variants: Variant[], personas: Persona[] = PERSONAS) {
  console.log(`\n== closed loop: ${title} (rooms=${ROOMS}, ${SEEDS} seeds x ${WEEKS} weeks) ==`)
  for (const v of variants) {
    console.log(` variant ${v.name}`)
    for (const p of personas) {
      const t = { base: 0, only: 0, extra: 0, moved: 0, bn: 0, bw: 0, vn: 0, vw: 0, bs: 0, vs: 0 }
      for (let s = 1; s <= SEEDS; s++) {
        const a = run(p, s, WEEKS, base, ROOMS)
        const b = run(p, s, WEEKS, v, ROOMS)
        const c = compare(a, b)
        t.base += c.base
        t.only += c.only
        t.extra += c.extra
        t.moved += c.moved
        const qa = quality(a)
        const qb = quality(b)
        t.bn += qa.n
        t.bw += qa.welcome
        t.vn += qb.n
        t.vw += qb.welcome
        t.bs += qa.soon
        t.vs += qb.soon
      }
      console.log(
        `   ${p.name.padEnd(18)} base nudges ${String(t.base).padStart(4)} | dropped ${pct(t.only, t.base).padStart(6)} added ${pct(t.extra, t.base).padStart(6)} moved>1h ${pct(t.moved, t.base).padStart(6)} | welcome: base ${t.bw}/${t.bn} (${pct(t.bw, t.bn)}) variant ${t.vw}/${t.vn} (${pct(t.vw, t.vn)}) | lands <=1h before a session: base ${pct(t.bs, t.bn)} variant ${pct(t.vs, t.vn)}`,
      )
    }
  }
}

function openLoopAppetite() {
  console.log(`\n== open loop: appetite (rooms=${ROOMS}) — same pass, same state, appetite swapped ==`)
  for (const p of PERSONAS) {
    const t = { passes: 0, pooled: 0, none: 0, cand: 0, pooledReasons: {} as Record<string, number>, noneReasons: {} as Record<string, number> }
    for (let s = 1; s <= SEEDS; s++) {
      run(p, s, WEEKS, BASE, ROOMS, (log, st) => {
        if (!log.items.length) return
        t.passes++
        const ctxFor = (appetite: AP.Appetite) => ({ now: log.at, level: "active" as const, away: false, budget: 10, busyRooms: log.busy, leads: { home: "@lead", work: "@lead", trip: "@lead", gym: "@lead", books: "@lead", money: "@lead", family: "@lead", code: "@lead" }, rhythm: RH.view(log.rhythm, log.at, TZ), appetite })
        const cs = log.items.map((i) => i.c)
        const base = attend(cs, ctxFor(st.appetiteOf("per-kind")))
        const nb = base.filter((v) => v.verdict === "nudge").map((v) => v.id).sort().join()
        for (const m of ["pooled", "none"] as const) {
          const alt = attend(cs, ctxFor(st.appetiteOf(m)))
          const na = alt.filter((v) => v.verdict === "nudge").map((v) => v.id).sort().join()
          if (na !== nb) {
            t[m]++
            // why: which reasons differ
            for (let i = 0; i < cs.length; i++) {
              const x = base[i]!
              const y = alt[i]!
              const rx = x.verdict === "brief" ? x.reason : x.verdict
              const ry = y.verdict === "brief" ? y.reason : y.verdict
              if (rx !== ry && (rx === "nudge" || ry === "nudge")) {
                const r = (m === "pooled" ? t.pooledReasons : t.noneReasons)
                r[`${rx}->${ry}`] = (r[`${rx}->${ry}`] ?? 0) + 1
              }
            }
          }
        }
      }, ["pooled", "none"])
    }
    console.log(`  ${p.name.padEnd(18)} passes ${t.passes} | per-kind->pooled changes ${pct(t.pooled, t.passes)} ${JSON.stringify(t.pooledReasons)} | per-kind->none changes ${pct(t.none, t.passes)} ${JSON.stringify(t.noneReasons)}`)
  }
}

function openLoopScore() {
  console.log(`\n== open loop: score (rooms=${ROOMS}) — same pass, worth from score vs simple(due, promise) ==`)
  for (const p of PERSONAS) {
    const t = { passes: 0, noJudge: 0, top10: 0, top10elig: 0, jPass: 0, brief: 0, briefRooms: 0 }
    for (let s = 1; s <= SEEDS; s++) {
      run(p, s, WEEKS, BASE, ROOMS, (log) => {
        if (!log.items.length) return
        t.passes++
        const view = RH.view(log.rhythm, log.at, TZ)
        const ctx = { now: log.at, level: "active" as const, away: false, budget: 10, busyRooms: log.busy, leads: Object.fromEntries(["home", "work", "trip", "gym", "books", "money", "family", "code"].map((r) => [r, "@lead"])), rhythm: view, appetite: log.appetite }
        const cs = log.items.map((i) => i.c)
        const nb = attend(cs, ctx).filter((v) => v.verdict === "nudge").map((v) => v.id).sort().join()
        const worth = Object.fromEntries(cs.map((c) => [c.id, c.certainty === "tentative" ? 0 : simple(c, log.at, view)]))
        const na = attend(cs, { ...ctx, worthNow: worth }).filter((v) => v.verdict === "nudge").map((v) => v.id).sort().join()
        if (na !== nb) t.noJudge++
        // With Jev: the score only picks which ten Jev reads.
        const elig = cs.filter((c) => log.at >= AP.restUntil(log.appetite, c, view.cycle, log.at) && !log.busy.includes(c.room))
        if (elig.length) {
          t.jPass++
          if (elig.length > 10) t.top10elig++
          const top = (f: (c: (typeof cs)[0]) => number) => elig.slice().sort((a, b) => f(b) - f(a)).slice(0, 10).map((c) => c.id).sort().join()
          if (top((c) => score(c, ctx)) !== top((c) => simple(c, log.at, view))) t.top10++
        }
        // noticed(): top two explicit human loops per room for the brief
        for (const room of new Set(cs.map((c) => c.room))) {
          const pool = cs.filter((c) => c.owner === "human" && c.room === room && c.certainty === "explicit" && c.id.startsWith("loop:") && log.at >= AP.restUntil(log.appetite, c, view.cycle, log.at))
          if (pool.length < 3) continue
          t.briefRooms++
          const top2 = (f: (c: (typeof cs)[0]) => number) => pool.slice().sort((a, b) => f(b) - f(a)).slice(0, 2).map((c) => c.id).sort().join()
          if (top2((c) => score(c, ctx)) !== top2((c) => simple(c, log.at, view))) t.brief++
        }
      })
    }
    console.log(`  ${p.name.padEnd(18)} passes ${t.passes} | no-Jev nudge set changes ${pct(t.noJudge, t.passes)} | Jev passes with >10 eligible ${pct(t.top10elig, t.jPass)}, top-10 set changes ${pct(t.top10, t.jPass)} | brief top-2 changes ${t.brief}/${t.briefRooms} (${pct(t.brief, t.briefRooms)})`)
  }
}

function openLoopRhythm() {
  console.log(`\n== open loop: rhythm (rooms=${ROOMS}) — final 168-slot histogram vs alternatives ==`)
  const alts = { "24": (r: RH.Rhythm) => fold(r) }
  for (const p of PERSONAS) {
    const t = { slots: 0, active: 0, moments: 0, momentsDiff: 0, momentsDay: 0, passes: 0, passActive: 0, deadline: 0, deadlineDiff: 0 }
    for (let s = 1; s <= SEEDS; s++) {
      const r = run(p, s, WEEKS, BASE, ROOMS, (log) => {
        t.passes++
        const a24 = RH.view(alts["24"](log.rhythm), log.at, TZ)
        if (a24.activeNow !== log.activeNow) t.passActive++
      })
      for (const wk of [4, WEEKS]) {
        const now = START + wk * 7 * DAY
        const rh = RH.decayed(r.passes.filter((x) => x.at <= now).at(-1)?.rhythm ?? RH.emptyRhythm(), now)
        if (!RH.known(rh)) continue
        for (let i = 0; i < 7 * 96; i++) {
          const at = now + i * 15 * 60_000
          t.slots++
          if (RH.view(rh, at, TZ).activeNow !== RH.view(alts["24"](rh), at, TZ).activeNow) t.active++
        }
        for (let d = 0; d < 7; d++) {
          const from = now + d * DAY
          const m1 = RH.nextMoment(rh, from, TZ)
          const m2 = RH.nextMoment(alts["24"](rh), from, TZ)
          t.moments++
          if (m1 !== m2 && (m1 === null || m2 === null || Math.abs(m1 - m2) > HOUR)) t.momentsDiff++
          if (m1 !== null && m2 !== null && Math.floor((m1 - START) / DAY) !== Math.floor((m2 - START) / DAY)) t.momentsDay++
          const d1 = RH.ignoreDeadline(rh, from + 12 * HOUR, TZ)
          const d2 = RH.ignoreDeadline(alts["24"](rh), from + 12 * HOUR, TZ)
          t.deadline++
          if (Math.abs(d1 - d2) > 6 * HOUR) t.deadlineDiff++
        }
      }
    }
    console.log(`  ${p.name.padEnd(18)} activeNow differs in ${pct(t.active, t.slots)} of week slots; at shipped passes ${pct(t.passActive, t.passes)} | next moment differs >1h ${pct(t.momentsDiff, t.moments)} (other day ${pct(t.momentsDay, t.moments)}) | ignore deadline differs >6h ${pct(t.deadlineDiff, t.deadline)}`)
  }
}

function fold(r: RH.Rhythm): RH.Rhythm {
  const w = new Array(168).fill(0)
  for (let h = 0; h < 24; h++) {
    let s = 0
    for (let d = 0; d < 7; d++) s += r.w[d * 24 + h] ?? 0
    for (let d = 0; d < 7; d++) w[d * 24 + h] = s / 7
  }
  return { w, at: r.at }
}

const which = process.argv[2] ?? "all"
const J = (v: Partial<Variant> & { name: string }): Variant => ({ ...BASE, ...v })
if (which === "all" || which === "appetite") {
  openLoopAppetite()
  closedLoop("appetite, no Jev", BASE, [J({ name: "pooled appetite", appetite: "pooled" }), J({ name: "no appetite (allowance 1, rest doubles)", appetite: "none" })])
  closedLoop("appetite, with Jev", J({ name: "shipped+jev", judge: true }), [J({ name: "pooled+jev", appetite: "pooled", judge: true }), J({ name: "none+jev", appetite: "none", judge: true })])
}
if (which === "all" || which === "rhythm") {
  openLoopRhythm()
  closedLoop("rhythm", BASE, [J({ name: "24-slot hour of day", rhythm: "24" }), J({ name: "168 no pooling", rhythm: "168-nopool" }), J({ name: "168 no smoothing", rhythm: "168-nosmooth" }), J({ name: "168 raw (neither)", rhythm: "168-raw" })])
}
if (which === "all" || which === "score") {
  openLoopScore()
  closedLoop("score, no Jev", BASE, [J({ name: "simple worth (due + promise only)", worth: "simple" })])
  closedLoop("score, with Jev", J({ name: "shipped+jev", judge: true }), [J({ name: "jev, ranked by simple", judge: true, worth: "simple" }), J({ name: "no Jev at all (score decides)" })])
}
