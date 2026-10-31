import type { Task } from "../../types"
import { int, mulberry32, pick, verdict, writeJson } from "../helpers"
import { answerCheck, BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const USERS = ["ada", "grace", "linus", "mira", "omar", "priya"]
const WORDS = ["harbor", "meadow", "cobalt", "summit", "orchid", "pepper"]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const user = `${pick(rng, USERS)}-${int(rng, 100, 999)}`
  return {
    user,
    password: `kiko-${int(rng, 1000, 9999)}-${pick(rng, WORDS)}`,
    token: `tok_${int(rng, 100000, 999999)}${pick(rng, WORDS)}`,
  }
}

export const oauthPopup: Task = {
  id: "browser-112-oauth-popup",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Sign in to the console at url.txt with the Example account. The password is in request.json. The sign-in opens in its own window; copy the access token it shows into the console and submit it.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", { password: data.password })
    await openPage(m, "browser-112-oauth-popup", data, "/login")
  },
  oracle: (m) => runBrowserOracle(m, "browser-112-oauth-popup"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const state = await browserState(m)
    return verdict([
      sameJson("authorized", state?.authorized, { user: expected.user }),
      await answerCheck(m, expected.token),
    ])
  },
}
