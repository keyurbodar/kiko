import { BROWSER } from "../config"
import type { Decider } from "./types"

/**
 * Jev answers in about 300 ms but is sometimes unsure of an action, as on a pizza form's checkbox. That step
 * goes to the agent's own model instead of ending the task.
 */
export function escalating(fast: Decider, careful: Decider): Decider {
  return {
    name: `${fast.name}+${careful.name}`,
    async decide(input, signal) {
      const first = await fast.decide(input, signal)
      if (first.confidence === null || first.confidence >= BROWSER.confidenceFloor) return first
      // An unsure "done" or "stuck" already hands the page back with its passages, which the main model reads.
      // Only an unsure action is worth a model call.
      const op = first.choice.step.op
      if (op === "done" || op === "stuck") return first
      return careful.decide(input, signal)
    },
  }
}
