import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, sample, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const REGIONS = ["north", "south", "east", "west", "central", "coastal", "highlands"]

const report = (seed: number) => {
  const rng = mulberry32(seed)
  const rows = sample(rng, REGIONS, 6).map((region) => ({ region, cents: int(rng, 1500, 98000) }))
  const cents = rows.reduce((sum, row) => sum + row.cents, 0)
  return { rows, total: (cents / 100).toFixed(2) }
}

export const download: Task = {
  id: "browser-005-download",
  track: "browser",
  os: ["linux", "macos", "windows"],
  needs: ["chrome"],
  heldOut: false,
  kind: "real",
  prompt:
    "Download the sales report linked from the page in url.txt and submit the total of the amount column in the answer form.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await openPage(m, "browser-005-download", report(seed), "/reports")
  },
  oracle: (m) => runBrowserOracle(m, "browser-005-download"),
  check: async (m, seed) => {
    const expected = report(seed).total
    const answer = (await browserState(m))?.answer as { value?: string } | undefined
    return verdict([
      check("answered", Boolean(answer), `state.answer = ${JSON.stringify(answer)}`),
      check("total", answer?.value === expected, `total = ${JSON.stringify(answer?.value)}, wanted ${expected}`),
    ])
  },
}
