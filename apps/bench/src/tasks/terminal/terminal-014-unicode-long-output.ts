import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, pick, readText, run, verdict, writeJson, writeText } from "../helpers"

const NAMES = [
  "Zoë",
  "李雷",
  "Ångström",
  "Ólafsdóttir",
  "Mira 🌟",
  "Ada",
  "Grace",
  "Linus",
  "Priya",
  "Omar",
  "Sven",
  "Nair",
]
const REGIONS = ["apac", "emea", "amer"]
const NOTES = ["needs review", "awaiting invoice", "priority account", "renewal soon"]

const EXTRACT = String.raw`const fs = require("node:fs")
const lines = fs.readFileSync("data.txt", "utf8").split("\n").filter(Boolean)
const out = lines
  .map((line) => line.split("\t"))
  .filter((parts) => parts[2] === "apac")
  .map((parts) => parts[1] + "\t" + parts[0])
fs.writeFileSync("apac.txt", out.join("\n") + "\n")
`

const plan = (seed: number): { data: string; expected: string } => {
  const rng = mulberry32(seed)
  const rows = Array.from({ length: 200 }, (_, index) => {
    const id = "u-" + String(1000 + index)
    const name = pick(rng, NAMES)
    const region = REGIONS[index % REGIONS.length]!
    const note = index === 37 ? "é".repeat(4000) : pick(rng, NOTES) + " " + int(rng, 1, 999)
    return { id, name, region, note }
  })
  const data = rows.map((row) => [row.id, row.name, row.region, row.note].join("\t")).join("\n") + "\n"
  const expected =
    rows
      .filter((row) => row.region === "apac")
      .map((row) => row.name + "\t" + row.id)
      .join("\n") + "\n"
  return { data, expected }
}

export const unicodeLongOutput: Task = {
  id: "terminal-014-unicode-long-output",
  track: "terminal",
  os: ["linux", "macos", "windows"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt:
    "Extract every record whose region is apac from data.txt and write `name<TAB>id` for each to apac.txt, one per line, in the same order as data.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "data.txt", plan(seed).data)
  },
  oracle: async (m) => {
    const result = await run(m, ["bun", "-e", EXTRACT])
    if (result.code !== 0) throw new Error("extract failed: " + (result.stderr || result.stdout))
  },
  check: async (m, seed) => {
    const actual = await readText(m, "apac.txt")
    const expected = plan(seed).expected
    const shown = actual === undefined ? "missing" : JSON.stringify(actual.slice(0, 400))
    return verdict([check("apac.txt", actual === expected, "apac.txt was " + shown)])
  },
}
