import type { Task } from "../../types"
import { check, int, mulberry32, verdict } from "../helpers"
import { hardState, launchHard, HARD_LIMITS, runHardOracle } from "./hard-support"

const codeFor = (seed: number): string => `H-${int(mulberry32(seed), 1000, 9999)}`

export const desktopHidpi: Task = {
  id: "desktop-110-hidpi",
  track: "desktop",
  kind: "edge",
  os: ["linux", "macos"],
  needs: ["display"],
  heldOut: false,
  prompt: "The app is running on a 200% scaled display. Enter the reference code from request.json and save.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "code", {}, { code: codeFor(seed) }, { env: { GDK_SCALE: "2" } })
  },
  oracle: (m) => runHardOracle(m, "hidpi"),
  check: async (m, seed) => {
    const expected = codeFor(seed)
    const state = await hardState(m)
    return verdict([check("code", state?.code === expected, `code = ${JSON.stringify(state?.code)}`)])
  },
}
