import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, sample, verdict } from "../helpers"
import { desktopState, launch, runDesktopOracle } from "./support"

const PLANS = ["Basic", "Pro", "Team", "Enterprise"]

const planFor = (seed: number) => {
  const rng = mulberry32(seed)
  const plans = sample(rng, PLANS, 3)
  return { plans, plan: pick(rng, plans) }
}

export const desktopRadio: Task = {
  id: "desktop-008-radio-group",
  track: "desktop",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  kind: "real",
  prompt: "In the open window, choose the plan named in request.json and apply it.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const data = planFor(seed)
    await launch(m, "radio", { plans: data.plans }, { plan: data.plan })
  },
  oracle: (m) => runDesktopOracle(m, "radio"),
  check: async (m, seed) => {
    const expected = planFor(seed).plan
    const state = await desktopState(m)
    return verdict([check("plan", state?.plan === expected, `state.plan = ${JSON.stringify(state?.plan)}`)])
  },
}
