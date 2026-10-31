import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, pick, sample, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const CUSTOMERS = [
  "Ada Lovelace",
  "Grace Hopper",
  "Linus Torvalds",
  "Mira Chen",
  "Omar Haddad",
  "Priya Nair",
  "Ruth Ginsburg",
  "Sven Berg",
]
const STATUSES = ["paid", "overdue", "draft"]

const ledger = (seed: number) => {
  const rng = mulberry32(seed)
  const invoices = sample(rng, CUSTOMERS, 4).flatMap((customer) =>
    sample(rng, STATUSES, 2).map((status) => ({
      id: `INV-${int(rng, 1000, 9999)}`,
      customer,
      status,
      amount: int(rng, 40, 900),
    })),
  )
  const target = pick(rng, invoices)
  return { invoices, target: { customer: target.customer, status: target.status }, id: target.id }
}

export const searchFilter: Task = {
  id: "browser-008-search-filter",
  track: "browser",
  os: ["linux", "macos"],
  needs: ["chrome"],
  heldOut: false,
  kind: "real",
  prompt:
    "On the invoices page in url.txt, find the invoice for the customer and status in request.json and submit its invoice number in the answer form.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const data = ledger(seed)
    await writeJson(m, "request.json", data.target)
    await openPage(m, "browser-008-search-filter", data, "/invoices")
  },
  oracle: (m) => runBrowserOracle(m, "browser-008-search-filter"),
  check: async (m, seed) => {
    const expected = ledger(seed).id
    const answer = (await browserState(m))?.answer as { value?: string } | undefined
    return verdict([
      check("answered", Boolean(answer), `state.answer = ${JSON.stringify(answer)}`),
      check("invoice", answer?.value === expected, `invoice = ${JSON.stringify(answer?.value)}, wanted ${expected}`),
    ])
  },
}
