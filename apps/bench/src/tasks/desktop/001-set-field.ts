import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const FIRST = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven"]
const LAST = ["Lovelace", "Hopper", "Torvalds", "Chen", "Haddad", "Nair", "Ginsburg", "Berg"]

const displayName = (seed: number): string => {
  const rng = mulberry32(seed)
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`
}

export const desktopForm: Task = {
  id: "desktop-001-set-field",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt: "In the open settings window, set the display name to the value in request.json and save.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await launch(m, "form", {}, { name: displayName(seed) })
  },
  oracle: (m) => runDesktopOracle(m, "form"),
  check: async (m, seed) => {
    const expected = displayName(seed)
    const state = await desktopState(m)
    return verdict([check("saved name", state?.saved === expected, `state.saved = ${JSON.stringify(state?.saved)}`)])
  },
}
