import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, sample, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const NAMES = ["Banana", "Cherry", "Dragonfruit", "Elderberry", "Fig", "Guava", "Kiwi", "Lychee", "Mango", "Papaya"]

const board = (seed: number) => {
  const rng = mulberry32(seed)
  const items = sample(rng, NAMES, 5)
  return { items, move: pick(rng, items.slice(1)) }
}

export const desktopList: Task = {
  id: "desktop-004-drag-list",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt: "In the open window, drag the item named in request.json to the top of the list.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const data = board(seed)
    await launch(m, "list", data, { move: data.move })
  },
  oracle: (m) => runDesktopOracle(m, "list"),
  check: async (m, seed) => {
    const data = board(seed)
    const order = (await desktopState(m))?.order as string[] | undefined
    return verdict([
      check("first", order?.[0] === data.move, `order = ${JSON.stringify(order)}`),
      check(
        "kept every item",
        Array.isArray(order) && [...order].sort().join("|") === [...data.items].sort().join("|"),
        `order = ${JSON.stringify(order)}`,
      ),
    ])
  },
}
