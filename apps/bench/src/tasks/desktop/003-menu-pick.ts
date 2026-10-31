import type { Task } from "../../types"
import { check, LIMITS, mulberry32, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const format = (seed: number): "csv" | "json" => (mulberry32(seed)() > 0.5 ? "csv" : "json")

export const desktopMenu: Task = {
  id: "desktop-003-menu-pick",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  kind: "real",
  prompt: "In the open window, use the File menu to export the data in the format named in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await launch(m, "menu", {}, { format: format(seed) })
  },
  oracle: (m) => runDesktopOracle(m, "menu"),
  check: async (m, seed) => {
    const expected = format(seed)
    const state = await desktopState(m)
    return verdict([check("exported", state?.export === expected, `state.export = ${JSON.stringify(state?.export)}`)])
  },
}
