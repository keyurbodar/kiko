import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const FIRST = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven", "Tomas", "Yuki", "Nora", "Ivan"]
const LAST = [
  "Lovelace",
  "Hopper",
  "Torvalds",
  "Chen",
  "Haddad",
  "Nair",
  "Ginsburg",
  "Berg",
  "Novak",
  "Sato",
  "Khan",
  "Silva",
]
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"

const registry = (seed: number) => {
  const rng = mulberry32(seed)
  const records = Array.from({ length: 34 }, (_, index) => {
    const name = `${FIRST[index % FIRST.length]} ${LAST[(index * 7) % LAST.length]}`
    const letter = LETTERS[Math.floor(rng() * LETTERS.length)]!
    return { id: `REC-${1000 + index}`, name, code: `${letter}${int(rng, 1000, 9999)}` }
  })
  const target = records[int(rng, 24, 33)]!
  return { records, targetId: target.id, code: target.code }
}

export const pagination: Task = {
  id: "browser-009-pagination",
  track: "browser",
  os: ["linux", "macos"],
  needs: ["chrome"],
  heldOut: true,
  prompt:
    "The records page in url.txt is split over several pages. Find the record whose ID is shown in the answer form and submit its code.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await openPage(m, "browser-009-pagination", registry(seed), "/records")
  },
  oracle: (m) => runBrowserOracle(m, "browser-009-pagination"),
  check: async (m, seed) => {
    const expected = registry(seed).code
    const answer = (await browserState(m))?.answer as { value?: string } | undefined
    return verdict([
      check("answered", Boolean(answer), `state.answer = ${JSON.stringify(answer)}`),
      check("code", answer?.value === expected, `code = ${JSON.stringify(answer?.value)}, wanted ${expected}`),
    ])
  },
}
