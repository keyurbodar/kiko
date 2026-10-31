import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const seconds = (seed: number): number => int(mulberry32(seed), 7, 93)

export const desktopSlider: Task = {
  id: "desktop-007-slider",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt: "In the open window, set the refresh interval to the number of seconds in request.json and save.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await launch(m, "slider", {}, { value: seconds(seed) })
  },
  oracle: (m) => runDesktopOracle(m, "slider"),
  check: async (m, seed) => {
    const expected = seconds(seed)
    const state = await desktopState(m)
    return verdict([check("value", state?.value === expected, `state.value = ${JSON.stringify(state?.value)}`)])
  },
}
