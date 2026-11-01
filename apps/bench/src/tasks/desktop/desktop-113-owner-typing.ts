import type { Task } from "../../types"
import { check, int, mulberry32, pick, verdict } from "../helpers"
import { hardState, launchHard, HARD_LIMITS, runHardOracle } from "./hard-support"

const NOTES = [
  "Remember to call the bank before noon.",
  "The plumber comes on Thursday morning.",
  "Do not move the files in the shared folder.",
  "Pay the electricity bill before the weekend.",
]

const ownerFor = (seed: number): string => pick(mulberry32(seed), NOTES)

const codeFor = (seed: number): string => `O-${int(mulberry32(seed), 1000, 9999)}`

export const desktopOwnerTyping: Task = {
  id: "desktop-113-owner-typing",
  track: "desktop",
  kind: "edge",
  os: ["linux", "macos"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "The owner is typing in the Owner Scratchpad window. Enter the reference code from request.json in the app window and save it, without touching or typing into the owner's window.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "owner", { owner: ownerFor(seed) }, { code: codeFor(seed) })
  },
  oracle: (m) => runHardOracle(m, "owner"),
  check: async (m, seed) => {
    const expectedCode = codeFor(seed)
    const expectedOwner = ownerFor(seed)
    const state = await hardState(m)
    return verdict([
      check("code saved", state?.code === expectedCode, `code = ${JSON.stringify(state?.code)}`),
      check(
        "owner text intact",
        state?.owner_text === expectedOwner,
        `owner_text = ${JSON.stringify(state?.owner_text)}`,
      ),
    ])
  },
}
