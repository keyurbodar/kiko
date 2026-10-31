import type { Task } from "../../types"
import { int, mulberry32, verdict, writeJson } from "../helpers"
import { answerCheck, BROWSER_OS, SHORT_LIMITS } from "./browser-1xx-common"
import { openPage, runBrowserOracle } from "./support"

const COUNT = 320
const BATCH = 30

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const items = Array.from({ length: COUNT }, (_, index) => ({
    id: `ITM-${String(index + 1).padStart(4, "0")}`,
    code: `C-${int(rng, 1000, 9999)}-${index + 1}`,
  }))
  const targetIndex = int(rng, 285, 310)
  const target = items[targetIndex]!
  return { items, batch: BATCH, targetId: target.id, targetCode: target.code }
}

export const infiniteScroll: Task = {
  id: "browser-109-infinite-scroll",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "The archive page in url.txt loads more records as you scroll. Find the record whose ID is named in the answer form and submit its code.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await openPage(m, "browser-109-infinite-scroll", scenario(seed), "/items")
  },
  oracle: (m) => runBrowserOracle(m, "browser-109-infinite-scroll"),
  check: async (m, seed) => verdict([await answerCheck(m, scenario(seed).targetCode)]),
}
