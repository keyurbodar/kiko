// Exhaustive grid over score(): which terms can carry a candidate over WORTH = 0.5 on their own,
// and how often dropping talked + stale flips worth >= 0.5 (no judge, appetite factor 1 and below).
import { score } from "../../../apps/server/src/initiative/attention/attend"
import type { Candidate, Kind } from "../../../apps/server/src/initiative/attention/types"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = 100 * DAY
const moments = Array.from({ length: 7 }, (_, i) => NOW + (i + 0.5) * DAY)
const rhythm = { known: true, activeNow: true, moments, cycle: DAY }
const kinds: Kind[] = ["goal", "intention", "commitment", "waiting", "project", "task", "routine"]
const owners = ["human", "scout"]
const dues: (number | undefined)[] = [undefined, -2 * DAY, -HOUR, 6 * HOUR, DAY, 2 * DAY, 3 * DAY, 5 * DAY, 10 * DAY]
const ages = [0.5, 1, 2, 4, 7, 14, 30, 60].map((d) => d * DAY)
const mentionsL = [1, 2, 3, 5, 10]
const factors = [1, 0.8, 0.6] // min(1, kindMean / 0.5)

let n = 0
let flips = 0
let maxNoDue = 0
const flipExamples: string[] = []
for (const kind of kinds)
  for (const owner of owners)
    for (const d of dues)
      for (const age of ages)
        for (const mentions of mentionsL)
          for (const f of factors) {
            const c: Candidate = { id: "c", kind, certainty: "explicit", owner, room: "r", ...(d === undefined ? {} : { due: NOW + d }), mentions, lastSeen: NOW - age, surfaced: 0, ignored: 0 }
            const s = score(c, { now: NOW, rhythm })
            // simplified: keep only due and promise
            const s2 = score({ ...c, mentions: 0, certainty: "tentative" }, { now: NOW, rhythm })
            if (d === undefined && !(owner !== "human" && (kind === "commitment" || kind === "task"))) maxNoDue = Math.max(maxNoDue, s)
            const a = s * f >= 0.5
            const b = s2 * f >= 0.5
            n++
            if (a !== b) {
              flips++
              if (flipExamples.length < 6) flipExamples.push(`${kind}/${owner} due=${d === undefined ? "none" : (d / DAY).toFixed(2) + "d"} age=${age / DAY}d m=${mentions} f=${f} full=${s.toFixed(3)} simple=${s2.toFixed(3)}`)
            }
          }
console.log(`grid cases ${n}; worth>=0.5 flips when talked+stale are removed: ${flips} (${((100 * flips) / n).toFixed(1)}%)`)
console.log(`max score with no due date and no agent promise: ${maxNoDue.toFixed(3)} (threshold 0.5)`)
for (const e of flipExamples) console.log("  flip:", e)
