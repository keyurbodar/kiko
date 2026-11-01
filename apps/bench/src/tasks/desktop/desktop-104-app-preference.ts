import type { Task } from "../../types"
import { check, int, mulberry32, verdict } from "../helpers"
import { HARD_LIMITS, hardState, launchHard, runHardOracle } from "./hard-support"

const preferences = (seed: number) => {
  const rng = mulberry32(seed)
  return { dark: rng() > 0.5, font: int(rng, 10, 20) }
}

export const desktopPreference: Task = {
  id: "desktop-104-app-preference",
  track: "desktop",
  kind: "real",
  os: ["linux", "macos"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "Open the app's preferences. Turn dark mode on or off to match request.json, set the font size to the number there, and confirm.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "prefs", {}, preferences(seed))
  },
  oracle: (m) => runHardOracle(m, "prefs"),
  check: async (m, seed) => {
    const expected = preferences(seed)
    const applied = (await hardState(m))?.applied as Record<string, unknown> | undefined
    return verdict([
      check("confirmed", Boolean(applied), `state.applied = ${JSON.stringify(applied)}`),
      check("dark mode", applied?.dark === expected.dark, `dark = ${JSON.stringify(applied?.dark)}`),
      check("font size", applied?.font === expected.font, `font = ${JSON.stringify(applied?.font)}`),
    ])
  },
}
