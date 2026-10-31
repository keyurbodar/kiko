import type { Task } from "../../types"
import { check, int, mulberry32, sample, verdict, writeJson } from "../helpers"
import { BROWSER_OS, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const NAMES = ["Aurora", "Basalt", "Cirrus", "Delta", "Ember", "Fjord", "Granite", "Harbor"]
const PRICES = [99.99, 129.99, 189.49, 249.99, 319.99]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const products = sample(rng, NAMES, 3).map((name) => {
    const price = PRICES[int(rng, 0, PRICES.length - 1)]!
    return {
      name,
      price,
      batteryHours: int(rng, 8, 40),
      shipping: price < 100 ? 4.99 : price < 300 ? 9.99 : 0,
      warranty: price > 200 ? 24 : 12,
    }
  })
  return { products }
}

export const productCompare: Task = {
  id: "browser-103-product-compare",
  track: "browser",
  kind: "real",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Compare the three field radios linked from the page in url.txt. Fill in the comparison table with each radio's price, battery life, shipping cost and warranty length, then submit it.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await openPage(m, "browser-103-product-compare", scenario(seed), "/shop")
  },
  oracle: (m) => runBrowserOracle(m, "browser-103-product-compare"),
  check: async (m, seed) => {
    const table = ((await browserState(m))?.comparison ?? {}) as Record<string, string>
    const checks = scenario(seed).products.flatMap((product, index) => [
      check(
        `p${index} price`,
        table[`p${index}_price`] === String(product.price),
        `price = ${JSON.stringify(table[`p${index}_price`])}, wanted ${product.price}`,
      ),
      check(
        `p${index} battery`,
        table[`p${index}_battery`] === String(product.batteryHours),
        `battery = ${JSON.stringify(table[`p${index}_battery`])}, wanted ${product.batteryHours}`,
      ),
      check(
        `p${index} shipping`,
        table[`p${index}_shipping`] === String(product.shipping),
        `shipping = ${JSON.stringify(table[`p${index}_shipping`])}, wanted ${product.shipping}`,
      ),
      check(
        `p${index} warranty`,
        table[`p${index}_warranty`] === String(product.warranty),
        `warranty = ${JSON.stringify(table[`p${index}_warranty`])}, wanted ${product.warranty}`,
      ),
    ])
    return verdict(checks)
  },
}
