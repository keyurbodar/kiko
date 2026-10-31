import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, pick, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const FIRST = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven"]
const LAST = ["Lovelace", "Hopper", "Torvalds", "Chen", "Haddad", "Nair", "Ginsburg", "Berg"]
const DOMAINS = ["example.com", "example.org", "mail.test"]

const details = (seed: number): { name: string; email: string; zip: string } => {
  const rng = mulberry32(seed)
  const first = pick(rng, FIRST)
  const last = pick(rng, LAST)
  return {
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@${pick(rng, DOMAINS)}`,
    zip: String(int(rng, 10000, 99999)),
  }
}

export const formSignup: Task = {
  id: "browser-001-form-signup",
  track: "browser",
  os: ["linux", "macos", "windows"],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Sign up for the newsletter on the page whose address is in url.txt. Use the name, email and postal code in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const request = details(seed)
    await writeJson(m, "request.json", request)
    await openPage(m, "browser-001-form-signup", request, "/signup")
  },
  oracle: (m) => runBrowserOracle(m, "browser-001-form-signup"),
  check: async (m, seed) => {
    const expected = details(seed)
    const signup = (await browserState(m))?.signup as Record<string, string> | undefined
    return verdict([
      check("submitted", Boolean(signup), `state.signup = ${JSON.stringify(signup)}`),
      check("name", signup?.name === expected.name, `name = ${JSON.stringify(signup?.name)}`),
      check("email", signup?.email === expected.email, `email = ${JSON.stringify(signup?.email)}`),
      check("zip", signup?.zip === expected.zip, `zip = ${JSON.stringify(signup?.zip)}`),
    ])
  },
}
