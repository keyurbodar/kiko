import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, pick, sample, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const CUSTOMERS = ["Ada Lovelace", "Grace Hopper", "Linus Torvalds", "Mira Chen", "Omar Haddad", "Priya Nair"]
const REASONS = ["arrived damaged", "wrong item", "late delivery", "missing parts"]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const customers = sample(rng, CUSTOMERS, 5)
  const orders = customers.map((customer) => ({
    id: `ORD-${int(rng, 1000, 9999)}`,
    customer,
    total: int(rng, 20, 400) + 0.5,
  }))
  const targetCustomer = pick(rng, customers)
  return { orders, targetCustomer, reason: pick(rng, REASONS) }
}

export const twoTabs: Task = {
  id: "browser-003-two-tabs",
  track: "browser",
  os: ["linux", "macos", "windows"],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "A customer wants to claim an order. Find their order number on the orders page linked from url.txt, then submit a claim for it on the claims page with the reason in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", { reason: data.reason })
    await openPage(m, "browser-003-two-tabs", data, "/orders")
  },
  oracle: (m) => runBrowserOracle(m, "browser-003-two-tabs"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const order = expected.orders.find((entry) => entry.customer === expected.targetCustomer)
    const claim = (await browserState(m))?.claim as { order?: string; reason?: string } | undefined
    return verdict([
      check("claimed", Boolean(claim), `state.claim = ${JSON.stringify(claim)}`),
      check("order", claim?.order === order?.id, `order = ${JSON.stringify(claim?.order)}, wanted ${order?.id}`),
      check("reason", claim?.reason === expected.reason, `reason = ${JSON.stringify(claim?.reason)}`),
    ])
  },
}
