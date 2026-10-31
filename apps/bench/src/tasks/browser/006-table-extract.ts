import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, sample, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const FIRST = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven", "Tomas", "Yuki"]
const LAST = ["Lovelace", "Hopper", "Torvalds", "Chen", "Haddad", "Nair", "Ginsburg", "Berg", "Novak", "Sato"]
const SALARIES = [71000, 84000, 92000, 98000, 105000, 112000, 119000, 126000, 133000, 141000]

const directory = (seed: number) => {
  const rng = mulberry32(seed)
  const people = sample(rng, SALARIES, 6).map((salary) => {
    const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`
    return { name, email: `${name.toLowerCase().replace(" ", ".")}@example.com`, salary }
  })
  const top = people.reduce((best, person) => (person.salary > best.salary ? person : best))
  return { people, email: top.email }
}

export const tableExtract: Task = {
  id: "browser-006-table-extract",
  track: "browser",
  os: ["linux", "macos", "windows"],
  needs: ["chrome"],
  heldOut: false,
  kind: "real",
  prompt:
    "On the team page in url.txt, find the highest paid person and submit their email address in the answer form.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await openPage(m, "browser-006-table-extract", directory(seed), "/team")
  },
  oracle: (m) => runBrowserOracle(m, "browser-006-table-extract"),
  check: async (m, seed) => {
    const expected = directory(seed).email
    const answer = (await browserState(m))?.answer as { value?: string } | undefined
    return verdict([
      check("answered", Boolean(answer), `state.answer = ${JSON.stringify(answer)}`),
      check("email", answer?.value === expected, `email = ${JSON.stringify(answer?.value)}, wanted ${expected}`),
    ])
  },
}
