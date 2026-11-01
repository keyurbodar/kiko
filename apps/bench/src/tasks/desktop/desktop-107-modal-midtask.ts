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

export const desktopModal: Task = {
  id: "desktop-107-modal-midtask",
  track: "desktop",
  kind: "edge",
  os: ["linux", "macos"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "Fill in the name and email from request.json and save. If the app interrupts you with a session message, deal with it and finish the job.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "modal", {}, contact(seed))
  },
  oracle: (m) => runHardOracle(m, "modal"),
  check: async (m, seed) => {
    const expected = contact(seed)
    const state = await hardState(m)
    return verdict([
      check("session message seen", state?.modal_shown === true, `modal_shown = ${JSON.stringify(state?.modal_shown)}`),
      check("name", state?.name === expected.name, `name = ${JSON.stringify(state?.name)}`),
      check("email", state?.email === expected.email, `email = ${JSON.stringify(state?.email)}`),
    ])
  },
}
