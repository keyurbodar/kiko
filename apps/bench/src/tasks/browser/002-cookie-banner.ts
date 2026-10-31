import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const LOCAL = ["ada", "grace", "linus", "mira", "omar", "priya"]

const emailFor = (seed: number): string => {
  const rng = mulberry32(seed)
  return `${pick(rng, LOCAL)}.${seed % 97}@example.com`
}

export const cookieBanner: Task = {
  id: "browser-002-cookie-banner",
  track: "browser",
  os: ["linux", "macos", "windows"],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Subscribe to product updates on the page whose address is in url.txt. Use the email address in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const request = { email: emailFor(seed) }
    await writeJson(m, "request.json", request)
    await openPage(m, "browser-002-cookie-banner", request, "/subscribe")
  },
  oracle: (m) => runBrowserOracle(m, "browser-002-cookie-banner"),
  check: async (m, seed) => {
    const expected = emailFor(seed)
    const state = await browserState(m)
    const subscription = state?.subscription as { email?: string } | undefined
    return verdict([
      check("consent", state?.consent === true, `state.consent = ${JSON.stringify(state?.consent)}`),
      check("email", subscription?.email === expected, `state.subscription = ${JSON.stringify(subscription)}`),
    ])
  },
}
