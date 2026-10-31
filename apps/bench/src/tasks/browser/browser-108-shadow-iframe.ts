import type { Task } from "../../types"
import { check, int, mulberry32, pick, verdict, writeJson } from "../helpers"
import { BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const USERS = ["ada", "grace", "linus", "mira", "omar", "priya"]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  return { user: `${pick(rng, USERS)}-${int(rng, 100, 999)}`, code: `V-${int(rng, 1000, 9999)}` }
}

export const shadowIframe: Task = {
  id: "browser-108-shadow-iframe",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Verify the account on the page in url.txt. The sign-in widget is embedded in the page, and the verification code is shown in the frame on that page. Enter the user name from request.json and the code, then verify.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", { user: data.user })
    await openPage(m, "browser-108-shadow-iframe", data, "/verify")
  },
  oracle: (m) => runBrowserOracle(m, "browser-108-shadow-iframe"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const state = await browserState(m)
    return verdict([
      check("verified", state?.verify !== undefined, `verify = ${JSON.stringify(state?.verify)}`),
      sameJson("verify", state?.verify, expected),
    ])
  },
}
