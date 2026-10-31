import type { Task } from "../../types"
import { LIMITS, matchesFile, mulberry32, pick, run, sample, verdict, writeJson, writeText } from "../helpers"

const NAMES = [
  "ada",
  "grace",
  "linus",
  "mira",
  "omar",
  "priya",
  "ruth",
  "sven",
  "zoe",
  "li",
  "olaf",
  "ingrid",
  "kai",
  "nora",
]
const DOMAINS = ["example.com", "example.org", "mail.test"]
const PLANS = ["free", "pro", "team"]

interface Row {
  readonly email: string
  readonly plan: string
  readonly updated: string
}

const pad = (value: number): string => String(value).padStart(2, "0")

const stamp = (index: number): string => {
  const day = 1 + Math.floor(index / 24)
  const hour = index % 24
  return "2026-10-" + pad(day) + "T" + pad(hour) + ":00:00Z"
}

const DEDUPE = String.raw`const fs = require("node:fs")
const lines = fs.readFileSync("signups.csv", "utf8").split("\n").filter(Boolean)
const header = lines[0]
const rows = lines.slice(1).map((line) => {
  const [email, plan, updated] = line.split(",")
  return { email, plan, updated }
})
const latest = new Map()
for (const row of rows) {
  const previous = latest.get(row.email)
  if (!previous || row.updated > previous.updated) latest.set(row.email, row)
}
const clean = [...latest.values()].sort((left, right) =>
  left.email < right.email ? -1 : left.email > right.email ? 1 : 0,
)
const out = [header, ...clean.map((row) => row.email + "," + row.plan + "," + row.updated)]
fs.writeFileSync("clean.csv", out.join("\n") + "\n")
`

const plan = (seed: number): { csv: string; expected: string } => {
  const rng = mulberry32(seed)
  const emails = NAMES.map((name, index) => name + "." + (index + 1) + "@" + pick(rng, DOMAINS))
  const stamps = sample(
    rng,
    Array.from({ length: 240 }, (_, index) => stamp(index)),
    20,
  )
  const rows: Row[] = emails.map((email, index) => ({
    email,
    plan: pick(rng, PLANS),
    updated: stamps[index]!,
  }))
  const repeats = sample(rng, emails, 6)
  for (const [offset, email] of repeats.entries()) {
    rows.push({ email, plan: pick(rng, PLANS), updated: stamps[emails.length + offset]! })
  }
  const shuffled = sample(rng, rows, rows.length)
  const latest = new Map<string, Row>()
  for (const row of shuffled) {
    const previous = latest.get(row.email)
    if (!previous || row.updated > previous.updated) latest.set(row.email, row)
  }
  const clean = [...latest.values()].sort((left, right) =>
    left.email < right.email ? -1 : left.email > right.email ? 1 : 0,
  )
  const header = "email,plan,updated"
  const expected = [header, ...clean.map((row) => row.email + "," + row.plan + "," + row.updated)].join("\n") + "\n"
  const csv = [header, ...shuffled.map((row) => row.email + "," + row.plan + "," + row.updated)].join("\n") + "\n"
  return { csv, expected }
}

export const csvDedupe: Task = {
  id: "terminal-019-csv-dedupe",
  track: "terminal",
  os: ["linux", "macos", "windows"],
  needs: [],
  heldOut: true,
  kind: "real",
  prompt:
    "signups.csv has duplicate emails. Write clean.csv with one row per email: the row with the latest updated timestamp, sorted by email, keeping the same header.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "signups.csv", plan(seed).csv)
  },
  oracle: async (m) => {
    const result = await run(m, ["bun", "-e", DEDUPE])
    if (result.code !== 0) throw new Error("dedupe failed: " + (result.stderr || result.stdout))
  },
  check: async (m, seed) => verdict([await matchesFile(m, "clean", "clean.csv", plan(seed).expected)]),
}
