import type { Task } from "../../types"
import { check, LIMITS, mulberry32, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const switches = (seed: number) => {
  const rng = mulberry32(seed)
  return { notifications: true, updates: rng() > 0.5 }
}

export const desktopSettings: Task = {
  id: "desktop-002-toggle-settings",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  kind: "real",
  prompt: "In the open settings window, set the two switches to match request.json, then apply the change.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await launch(m, "settings", {}, switches(seed))
  },
  oracle: (m) => runDesktopOracle(m, "settings"),
  check: async (m, seed) => {
    const expected = switches(seed)
    const applied = (await desktopState(m))?.applied as Record<string, boolean> | undefined
    return verdict([
      check("applied", Boolean(applied), `state.applied = ${JSON.stringify(applied)}`),
      check(
        "notifications",
        applied?.notifications === expected.notifications,
        `notifications = ${JSON.stringify(applied?.notifications)}`,
      ),
      check("updates", applied?.updates === expected.updates, `updates = ${JSON.stringify(applied?.updates)}`),
    ])
  },
}
