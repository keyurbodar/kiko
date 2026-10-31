import type { Task } from "../../types"
import { check, int, mulberry32, verdict, writeJson } from "../helpers"
import { BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const iso = (base: string, offset: number): string => {
  const date = new Date(`${base}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

const isWeekday = (date: string): boolean => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6
}

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const after = `2026-11-${String(int(rng, 2, 6)).padStart(2, "0")}`
  const blocked = new Set([after, iso(after, 1), iso(after, 4)])
  const days = Array.from({ length: 21 }, (_, offset) => {
    const date = iso(after, offset)
    return { date, disabled: !isWeekday(date) || blocked.has(date) }
  })
  return { after, days, target: days.find((day) => !day.disabled)!.date }
}

export const datePicker: Task = {
  id: "browser-115-date-picker",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Book the first available appointment on the page in url.txt. The days that are greyed out cannot be booked, so pick the earliest day that is open.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", { after: data.after })
    await openPage(m, "browser-115-date-picker", { days: data.days, target: data.target }, "/book")
  },
  oracle: (m) => runBrowserOracle(m, "browser-115-date-picker"),
  check: async (m, seed) => {
    const state = await browserState(m)
    return verdict([
      check("booked", state?.booking !== undefined, `booking = ${JSON.stringify(state?.booking)}`),
      sameJson("date", state?.booking, { date: scenario(seed).target }),
    ])
  },
}
