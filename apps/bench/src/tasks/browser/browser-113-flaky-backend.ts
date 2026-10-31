import type { Task } from "../../types"
import { check, int, mulberry32, verdict, writeJson } from "../helpers"
import { BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const scenario = (seed: number) => ({ value: String(int(mulberry32(seed), 1000, 99999)) })

export const flakyBackend: Task = {
  id: "browser-113-flaky-backend",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Submit the meter reading on the page in url.txt. The service is slow and unreliable today, so keep trying until it accepts the reading, but send it only once successfully.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await openPage(m, "browser-113-flaky-backend", scenario(seed), "/submit")
  },
  oracle: (m) => runBrowserOracle(m, "browser-113-flaky-backend"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const state = await browserState(m)
    return verdict([
      sameJson("submitted", state?.submitted, { value: expected.value, attempts: 2 }),
      check("two attempts", state?.attempts === 2, `attempts = ${JSON.stringify(state?.attempts)}`),
    ])
  },
}
