import type { Task } from "../../types"
import { check, int, mulberry32, verdict } from "../helpers"
import { hardState, launchHard, HARD_LIMITS, runHardOracle } from "./hard-support"

const codeFor = (seed: number): string => `R-${int(mulberry32(seed), 1000, 9999)}`

export const desktopSameTitle: Task = {
  id: "desktop-109-same-title",
  track: "desktop",
  kind: "edge",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "Two windows are both called Bench Fixture. In the one on the right, which has the Reference code field, enter the code from request.json and save. Leave the other window alone.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "same_title", {}, { code: codeFor(seed) })
  },
  oracle: (m) => runHardOracle(m, "same_title"),
  check: async (m, seed) => {
    const expected = codeFor(seed)
    const state = await hardState(m)
    return verdict([
      check(
        "right window saved",
        state?.target_code === expected,
        `target_code = ${JSON.stringify(state?.target_code)}`,
      ),
      check("left window untouched", state?.decoy_text === "", `decoy_text = ${JSON.stringify(state?.decoy_text)}`),
    ])
  },
}
