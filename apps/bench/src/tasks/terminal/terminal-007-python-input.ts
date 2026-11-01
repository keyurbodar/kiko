import type { Task } from "../../types"
import { bun, check, int, LIMITS, mulberry32, pick, python, readJson, verdict, writeJson, writeText } from "../helpers"

const FIRST = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven"]
const LAST = ["Lovelace", "Hopper", "Torvalds", "Chen", "Haddad", "Nair", "Ginsburg", "Berg"]

const SURVEY = `import json

name = input("Full name: ")
age = input("Age: ")
with open("answers.json", "w", encoding="utf-8") as handle:
    json.dump({"name": name, "age": age}, handle)
`

const details = (seed: number): { readonly name: string; readonly age: number } => {
  const rng = mulberry32(seed)
  return { name: `${pick(rng, FIRST)} ${pick(rng, LAST)}`, age: int(rng, 18, 79) }
}

export const pythonInput: Task = {
  id: "terminal-007-python-input",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt: "Run survey.py and answer its two prompts with the name and age in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", details(seed))
    await writeText(m, "survey.py", SURVEY)
  },
  oracle: async (m, seed) => {
    const request = details(seed)
    const input = `${request.name}\n${request.age}\n`
    const code = `const child = Bun.spawn([${JSON.stringify(python(m))}, "survey.py"], { stdin: new Response(${JSON.stringify(input)}), stdout: "ignore", stderr: "inherit" })
const exit = await child.exited
process.exit(exit)`
    await bun(m, code)
  },
  check: async (m, seed) => {
    const request = details(seed)
    const answers = await readJson<{ name: string; age: string }>(m, "answers.json")
    return verdict([
      check("name", answers?.name === request.name, `answers.name was ${JSON.stringify(answers?.name)}`),
      check("age", String(answers?.age) === String(request.age), `answers.age was ${JSON.stringify(answers?.age)}`),
    ])
  },
}
