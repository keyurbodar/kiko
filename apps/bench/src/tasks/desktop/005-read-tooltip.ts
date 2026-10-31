import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"

const recoveryCode = (seed: number): string => {
  const rng = mulberry32(seed)
  const letter = LETTERS[Math.floor(rng() * LETTERS.length)]!
  return `${letter}${int(rng, 100, 999)}-${int(rng, 1000, 9999)}`
}

export const desktopTooltip: Task = {
  id: "desktop-005-read-tooltip",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: true,
  kind: "real",
  prompt:
    "In the open window, hover the question mark to read the recovery code, type it into the recovery code field and submit it.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await launch(m, "tooltip", { code: recoveryCode(seed) }, {})
  },
  oracle: (m) => runDesktopOracle(m, "tooltip"),
  check: async (m, seed) => {
    const expected = recoveryCode(seed)
    const state = await desktopState(m)
    return verdict([check("code", state?.code === expected, `state.code = ${JSON.stringify(state?.code)}`)])
  },
}
