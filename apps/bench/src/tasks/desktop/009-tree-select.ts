import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, sample, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const GROUPS = ["North region", "South region", "East region"]
const ITEMS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]

const forest = (seed: number) => {
  const rng = mulberry32(seed)
  const groups = sample(rng, GROUPS, 2).map((name, index) => ({
    name,
    items: sample(rng, ITEMS, 3).map((item) => `${item}-${index + 1}`),
  }))
  const group = pick(rng, groups)
  return { groups, group: group.name, item: pick(rng, group.items) }
}

export const desktopTree: Task = {
  id: "desktop-009-tree-select",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: true,
  kind: "real",
  prompt: "In the open window, expand the group named in request.json, select the item named there, and choose it.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const data = forest(seed)
    await launch(m, "tree", { groups: data.groups }, { group: data.group, item: data.item })
  },
  oracle: (m) => runDesktopOracle(m, "tree"),
  check: async (m, seed) => {
    const expected = forest(seed).item
    const state = await desktopState(m)
    return verdict([check("chosen", state?.chosen === expected, `state.chosen = ${JSON.stringify(state?.chosen)}`)])
  },
}
