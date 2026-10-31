import type { Task } from "../../types"
import { check, int, mulberry32, pick, sample, verdict, writeJson } from "../helpers"
import { BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const FIRST = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven"]
const LAST = ["Lovelace", "Hopper", "Torvalds", "Chen", "Haddad", "Nair", "Ginsburg", "Berg"]
const STREETS = ["Harbor Road", "Mill Lane", "Cedar Street", "Orchard Way", "Summit Drive"]
const CITIES = ["Springfield", "Riverton", "Fairview", "Lakeside"]
const CATALOGUE = [
  { name: "Field radio", priceCents: 8999 },
  { name: "Spare battery", priceCents: 2499 },
  { name: "Carry case", priceCents: 3499 },
  { name: "Antenna kit", priceCents: 4599 },
  { name: "Handset", priceCents: 12999 },
]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const items = sample(rng, CATALOGUE, int(rng, 2, 3)).map((item) => ({ ...item, qty: int(rng, 1, 2) }))
  const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`
  const correct = {
    name,
    street: `${int(rng, 10, 980)} ${pick(rng, STREETS)}`,
    city: pick(rng, CITIES),
    postal: String(int(rng, 10000, 99999)),
    email: `${name.toLowerCase().replace(" ", ".")}@example.com`,
    card: `4242${int(rng, 10000000, 99999999)}${int(rng, 1000, 9999)}`,
    expiry: `12/${int(rng, 27, 30)}`,
  }
  const prefill = { ...correct, postal: correct.postal.slice(0, 4), expiry: "09/26" }
  const total = items.reduce((sum, item) => sum + item.priceCents * item.qty, 0) / 100
  return { items, correct, prefill, total }
}

export const checkoutTask: Task = {
  id: "browser-101-checkout",
  track: "browser",
  kind: "real",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Finish the checkout for the cart on the page in url.txt. Use the customer and payment details in request.json. The form is pre-filled, but some of those values are wrong, so check every step against request.json before you place the order.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", data.correct)
    await openPage(m, "browser-101-checkout", data, "/checkout/address")
  },
  oracle: (m) => runBrowserOracle(m, "browser-101-checkout"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const state = await browserState(m)
    const order = state?.order as
      | { items: unknown; total: number; address: unknown; payment: { last4?: string; expiry?: string } }
      | undefined
    const address = {
      name: expected.correct.name,
      street: expected.correct.street,
      city: expected.correct.city,
      postal: expected.correct.postal,
      email: expected.correct.email,
    }
    return verdict([
      sameJson("address", state?.address, address),
      sameJson("payment", state?.payment, {
        last4: expected.correct.card.slice(-4),
        expiry: expected.correct.expiry,
      }),
      check("order placed", Boolean(order), `state.order = ${JSON.stringify(order)}`),
      sameJson("items", order?.items, expected.items),
      check(
        "total",
        order?.total === expected.total,
        `total = ${JSON.stringify(order?.total)}, wanted ${expected.total}`,
      ),
      sameJson("order address", order?.address, address),
      sameJson("order payment", order?.payment, {
        last4: expected.correct.card.slice(-4),
        expiry: expected.correct.expiry,
      }),
    ])
  },
}
