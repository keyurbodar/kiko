import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const WORDS = ["harbor", "meadow", "cobalt", "summit", "orchid", "pepper"]

const pickWord = (rng: () => number): string => WORDS[Math.floor(rng() * WORDS.length)]!

const account = (seed: number) => {
  const rng = mulberry32(seed)
  const user = `ops-${int(rng, 100, 999)}`
  const password = `kiko-${int(rng, 1000, 9999)}-${pickWord(rng)}`
  const token = `tok_${int(rng, 100000, 999999)}${pickWord(rng)}`
  return { user, password, token }
}

export const login: Task = {
  id: "browser-007-login",
  track: "browser",
  os: ["linux", "macos", "windows"],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Sign in on the page in url.txt with the username and password in request.json, then submit the access token shown on the account page in the answer form.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const data = account(seed)
    await writeJson(m, "request.json", { user: data.user, password: data.password })
    await openPage(m, "browser-007-login", data, "/login")
  },
  oracle: (m) => runBrowserOracle(m, "browser-007-login"),
  check: async (m, seed) => {
    const expected = account(seed)
    const state = await browserState(m)
    const login = state?.login as { user?: string } | undefined
    const answer = state?.answer as { value?: string } | undefined
    return verdict([
      check("signed in", login?.user === expected.user, `state.login = ${JSON.stringify(login)}`),
      check("token", answer?.value === expected.token, `token = ${JSON.stringify(answer?.value)}`),
    ])
  },
}
