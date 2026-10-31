import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const ratingFor = (seed: number): number => int(mulberry32(seed), 1, 5)

export const hiddenTab: Task = {
  id: "browser-004-hidden-tab",
  track: "browser",
  os: ["linux", "macos", "windows"],
  needs: ["chrome"],
  heldOut: true,
  kind: "edge",
  prompt:
    "Keep the dashboard at url.txt open in one tab. In another tab, answer the survey with the rating in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const request = { rating: ratingFor(seed) }
    await writeJson(m, "request.json", request)
    await openPage(m, "browser-004-hidden-tab", request, "/dashboard")
  },
  oracle: (m) => runBrowserOracle(m, "browser-004-hidden-tab"),
  check: async (m, seed) => {
    const expected = String(ratingFor(seed))
    const state = await browserState(m)
    const survey = state?.survey as { rating?: string } | undefined
    return verdict([
      check(
        "dashboard open",
        state?.dashboardOpen === true,
        `state.dashboardOpen = ${JSON.stringify(state?.dashboardOpen)}`,
      ),
      check(
        "dashboard stayed open",
        !state?.dashboardClosed,
        `state.dashboardClosed = ${JSON.stringify(state?.dashboardClosed)}`,
      ),
      check("rating", survey?.rating === expected, `rating = ${JSON.stringify(survey?.rating)}, wanted ${expected}`),
    ])
  },
}
