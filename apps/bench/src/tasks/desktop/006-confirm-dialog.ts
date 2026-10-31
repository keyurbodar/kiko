import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const DRAFTS = ["weekly update", "incident notes", "travel request", "budget draft", "release checklist"]

const draftFor = (seed: number): string => pick(mulberry32(seed), DRAFTS)

export const desktopDialog: Task = {
  id: "desktop-006-confirm-dialog",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt: "In the open window, discard the unsaved draft and close the window.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await launch(m, "dialog", { draft: draftFor(seed) }, {})
  },
  oracle: (m) => runDesktopOracle(m, "dialog"),
  check: async (m) => {
    const state = await desktopState(m)
    return verdict([check("closed", state?.closed === "discard", `state.closed = ${JSON.stringify(state?.closed)}`)])
  },
}
