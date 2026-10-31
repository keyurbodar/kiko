import type { Task } from "../../types"
import { check, int, mulberry32, pick, verdict, writeJson, writeText } from "../helpers"
import { BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const VENDORS = ["Harbor Tools", "Cedar Works", "Summit Supply", "Mill Parts"]
const DESCRIPTIONS = ["Quarterly tool purchase", "Replacement parts", "Site supplies", "Repair invoice"]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  return {
    filename: "receipt.txt",
    content: `${pick(rng, VENDORS)}\nReceipt ${int(rng, 1000, 9999)}\nTotal: ${int(rng, 10, 900)}.${String(int(rng, 0, 99)).padStart(2, "0")}\n`,
    description: pick(rng, DESCRIPTIONS),
  }
}

export const fileUpload: Task = {
  id: "browser-116-file-upload",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Submit the receipt on the page in url.txt. Attach the receipt.txt file from the working directory and use the description in request.json.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", { description: data.description })
    await writeText(m, "receipt.txt", data.content)
    await openPage(m, "browser-116-file-upload", { filename: data.filename }, "/upload")
  },
  oracle: (m) => runBrowserOracle(m, "browser-116-file-upload"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const state = await browserState(m)
    return verdict([
      check("uploaded", state?.upload !== undefined, `upload = ${JSON.stringify(state?.upload)}`),
      sameJson("upload", state?.upload, {
        filename: expected.filename,
        content: expected.content,
        description: expected.description,
      }),
    ])
  },
}
