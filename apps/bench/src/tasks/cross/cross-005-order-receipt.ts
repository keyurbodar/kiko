import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, pick, readText, verdict, writeJson, writeText } from "../helpers"
import { crossState, openCross, readBrowserValue, submitInBrowser } from "./support"

const CUSTOMERS = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Mira Chen", "Omar Haddad", "Priya Nair"]

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

interface Order {
  readonly id: string
  readonly customer: string
  readonly status: string
  readonly receipt: string
  readonly total: string
}

interface Plan {
  readonly orders: Order[]
  readonly receipts: Record<string, string>
  readonly pending: Order
}

const plan = (seed: number): Plan => {
  const rng = mulberry32(seed)
  const pendingIndex = int(rng, 0, 5)
  const orders = Array.from({ length: 6 }, (_, index) => ({
    id: `ORD-${1000 + index}`,
    customer: pick(rng, CUSTOMERS),
    status: index === pendingIndex ? "pending" : "paid",
    receipt: `receipts/${hex(rng, 10)}.txt`,
    total: (int(rng, 1000, 90000) / 100).toFixed(2),
  }))
  const receipts: Record<string, string> = {}
  for (const order of orders) receipts[order.receipt] = `order: ${order.id}\ntotal: ${order.total}\n`
  for (let index = 0; index < 14; index += 1) {
    const id = `ORD-${2000 + index}`
    receipts[`receipts/${hex(rng, 10)}.txt`] = `order: ${id}\ntotal: ${(int(rng, 100, 9000) / 100).toFixed(2)}\n`
  }
  const pending = orders[pendingIndex]!
  return { orders, receipts, pending }
}

export const orderReceipt: Task = {
  id: "cross-005-order-receipt",
  track: "cross",
  os: ["linux", "macos"],
  needs: ["chrome"],
  heldOut: false,
  kind: "real",
  prompt:
    "The orders page at url.txt has one order still pending. Open its receipt in receipts/, read the total, and settle the order on the page with that total.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { orders, receipts } = plan(seed)
    await writeJson(m, "request.json", { action: "settle" })
    for (const [path, text] of Object.entries(receipts)) await writeText(m, path, text)
    await openCross(m, "cross-005-order-receipt", { orders }, "/")
  },
  oracle: async (m, seed) => {
    const { pending } = plan(seed)
    const order = await readBrowserValue("cross-005-order-receipt", m.workdir)
    if (order !== pending.id) throw new Error(`unexpected pending order ${order}`)
    const receipt = (await readText(m, pending.receipt)) ?? ""
    const total = receipt.match(/total:\s*(\S+)/)?.[1]
    if (!total) throw new Error(`no total in ${pending.receipt}`)
    await submitInBrowser("cross-005-order-receipt", m.workdir, total)
  },
  check: async (m, seed) => {
    const { pending, receipts } = plan(seed)
    const state = await crossState(m)
    const settled = state?.settled as { order?: string; total?: string } | undefined
    const intact = await Promise.all(
      Object.entries(receipts).map(async ([path, text]) => ({ path, ok: (await readText(m, path)) === text })),
    )
    return verdict([
      check("order settled", settled?.order === pending.id, `state.settled was ${JSON.stringify(settled)}`),
      check("total matches", settled?.total === pending.total, `total was ${JSON.stringify(settled?.total)}`),
      check(
        "receipts untouched",
        intact.every((entry) => entry.ok),
        `changed receipts: ${JSON.stringify(intact.filter((entry) => !entry.ok).map((entry) => entry.path))}`,
      ),
    ])
  },
}
