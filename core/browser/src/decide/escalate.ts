import { BROWSER } from "../config"
import type { Decider } from "./types"

export function escalating(fast: Decider, careful: Decider): Decider {
  return {
    name: `${fast.name}+${careful.name}`,
    async decide(input, signal) {
      const first = await fast.decide(input, signal)
      if (first.confidence === null || first.confidence >= BROWSER.confidenceFloor) return first
      // An unsure done or stuck already hands the page back; only an unsure action needs the careful model.
      const op = first.choice.step.op
      if (op === "done" || op === "stuck") return first
      return careful.decide(input, signal)
    },
  }
}
