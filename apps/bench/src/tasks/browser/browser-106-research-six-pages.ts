import type { Task } from "../../types"
import { int, mulberry32, pick, verdict, writeJson } from "../helpers"
import { answerCheck, BROWSER_OS, LONG_LIMITS } from "./browser-1xx-common"
import { openPage, runBrowserOracle } from "./support"

const SLUGS = ["north", "south", "east"] as const
const NAMES: Record<string, string> = { north: "North", south: "South", east: "East" }

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const retired = pick(rng, SLUGS)
  const regions = SLUGS.map((slug) => ({
    slug,
    name: NAMES[slug]!,
    replicas: int(rng, 8, 24),
    active: slug !== retired,
  }))
  const drain = int(rng, 2, 5)
  const sparePercent = pick(rng, [10, 20, 25])
  const serving = regions.filter((region) => region.active).reduce((sum, region) => sum + region.replicas - drain, 0)
  return { regions, drain, sparePercent, answer: Math.ceil((serving * sparePercent) / 100) }
}

export const researchSixPages: Task = {
  id: "browser-106-research-six-pages",
  track: "browser",
  kind: "long",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "For the capacity review, work out how many spare replicas we need to keep after the next maintenance window. The ops wiki at url.txt has every number you need. Put the count in the answer form.",
  limits: LONG_LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await openPage(m, "browser-106-research-six-pages", scenario(seed), "/wiki")
  },
  oracle: (m) => runBrowserOracle(m, "browser-106-research-six-pages"),
  check: async (m, seed) => verdict([await answerCheck(m, String(scenario(seed).answer))]),
}
