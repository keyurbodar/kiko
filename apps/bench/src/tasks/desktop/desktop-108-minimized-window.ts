import type { Task } from "../../types"
import { check, int, mulberry32, verdict } from "../helpers"
import { hardState, launchHard, HARD_LIMITS, runHardOracle } from "./hard-support"

const codeFor = (seed: number): string => `K-${int(mulberry32(seed), 1000, 9999)}`

export const desktopMinimized: Task = {
  id: "desktop-108-minimized-window",
  track: "desktop",
  kind: "edge",
  os: ["linux", "macos"],
  needs: ["display"],
  heldOut: false,
  prompt: "The app is minimized. Restore it, enter the reference code from request.json and save.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "minimized", {}, { code: codeFor(seed) })
  },
  oracle: (m) => runHardOracle(m, "minimized"),
  check: async (m, seed) => {
    const expected = codeFor(seed)
    const state = await hardState(m)
    return verdict([check("code", state?.code === expected, `code = ${JSON.stringify(state?.code)}`)])
  },
}
