import type { Task } from "../../types"
import { check, mulberry32, pick, verdict } from "../helpers"
import { hardState, launchHard, HARD_LIMITS, runHardOracle } from "./hard-support"

const FIRST = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven"]
const LAST = ["Lovelace", "Hopper", "Torvalds", "Chen", "Haddad", "Nair", "Ginsburg", "Berg"]

const contact = (seed: number) => {
  const rng = mulberry32(seed)
  const first = pick(rng, FIRST)
  const last = pick(rng, LAST)
  return { name: `${first} ${last}`, email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com` }
}

export const desktopNotification: Task = {
  id: "desktop-112-notification",
  track: "desktop",
  kind: "edge",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "Fill in the name and email from request.json and save. A message may pop up over the form while you work; dismiss it and finish the form.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "notification", {}, contact(seed))
  },
  oracle: (m) => runHardOracle(m, "notification"),
  check: async (m, seed) => {
    const expected = contact(seed)
    const state = await hardState(m)
    return verdict([
      check("name", state?.name === expected.name, `name = ${JSON.stringify(state?.name)}`),
      check("email", state?.email === expected.email, `email = ${JSON.stringify(state?.email)}`),
      check("message dismissed", state?.dismissed === true, `dismissed = ${JSON.stringify(state?.dismissed)}`),
    ])
  },
}
