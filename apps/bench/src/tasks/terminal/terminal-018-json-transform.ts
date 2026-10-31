import { isDeepStrictEqual } from "node:util"
import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, pick, readJson, run, sample, verdict, writeJson } from "../helpers"

const ORDER_IDS = ["ORD-1001", "ORD-1002", "ORD-1003", "ORD-1004", "ORD-1005", "ORD-1006"]
const NAMES = ["Ada Lovelace", "Grace Hopper", "Linus Torvalds", "Mira Chen", "Omar Haddad", "Priya Nair"]
const SKUS = ["SKU-101", "SKU-202", "SKU-303", "SKU-404", "SKU-505"]
const PRICES = [199, 250, 499, 750, 1200, 1999]
const OTHER_STATUSES = ["pending", "cancelled", "refunded"]

interface Item {
  readonly sku: string
  readonly qty: number
  readonly priceCents: number
}

interface Order {
  readonly id: string
  readonly customer: { readonly name: string }
  readonly items: readonly Item[]
  readonly status: string
}

interface Summary {
  readonly orders: readonly { readonly id: string; readonly totalCents: number; readonly itemCount: number }[]
  readonly grandTotalCents: number
}

const TRANSFORM = String.raw`const fs = require("node:fs")
const input = JSON.parse(fs.readFileSync("orders.json", "utf8"))
const orders = input.orders
  .filter((order) => order.status === "paid")
  .map((order) => ({
    id: order.id,
    totalCents: order.items.reduce((sum, item) => sum + item.qty * item.priceCents, 0),
    itemCount: order.items.length,
  }))
  .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
const grandTotalCents = orders.reduce((sum, order) => sum + order.totalCents, 0)
fs.writeFileSync("summary.json", JSON.stringify({ orders, grandTotalCents }, null, 2) + "\n")
`

const plan = (seed: number): { orders: Order[]; expected: Summary } => {
  const rng = mulberry32(seed)
  const ids = sample(rng, ORDER_IDS, ORDER_IDS.length)
  const orders = ids.map((id, index) => {
    const status = index % 2 === 0 ? "paid" : pick(rng, OTHER_STATUSES)
    const items = Array.from({ length: int(rng, 1, 4) }, () => ({
      sku: pick(rng, SKUS),
      qty: int(rng, 1, 5),
      priceCents: pick(rng, PRICES),
    }))
    return { id, customer: { name: pick(rng, NAMES) }, items, status }
  })
  const summarized = orders
    .filter((order) => order.status === "paid")
    .map((order) => ({
      id: order.id,
      totalCents: order.items.reduce((sum, item) => sum + item.qty * item.priceCents, 0),
      itemCount: order.items.length,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const grandTotalCents = summarized.reduce((sum, order) => sum + order.totalCents, 0)
  return { orders, expected: { orders: summarized, grandTotalCents } }
}

export const jsonTransform: Task = {
  id: "terminal-018-json-transform",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "Build summary.json from orders.json: `{orders:[{id, totalCents, itemCount}]}` sorted by id, plus `grandTotalCents`. Only include orders whose status is paid.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeJson(m, "orders.json", { orders: plan(seed).orders })
  },
  oracle: async (m) => {
    const result = await run(m, ["bun", "-e", TRANSFORM])
    if (result.code !== 0) throw new Error("transform failed: " + (result.stderr || result.stdout))
  },
  check: async (m, seed) => {
    const summary = await readJson<Summary>(m, "summary.json")
    const expected = plan(seed).expected
    return verdict([
      check("summary.json exists", summary !== undefined, "summary.json was " + JSON.stringify(summary)),
      check("contents", isDeepStrictEqual(summary, expected), "summary.json was " + JSON.stringify(summary)),
    ])
  },
}
