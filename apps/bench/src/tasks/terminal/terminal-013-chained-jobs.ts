import type { Machine, Task } from "../../types"
import { int, LIMITS, matchesFile, mulberry32, run, verdict, writeJson, writeText } from "../helpers"

const EXTRACT = String.raw`const raw = await Bun.file("raw.txt").text().catch(() => undefined)
if (raw === undefined) {
  console.error("raw.txt is missing")
  process.exit(1)
}
const ids = raw.split("\n").map((line) => line.trim()).filter(Boolean)
await Bun.write("ids.json", JSON.stringify(ids))
`

const RESOLVE = String.raw`const text = await Bun.file("ids.json").text().catch(() => undefined)
if (text === undefined) {
  console.error("ids.json is missing")
  process.exit(1)
}
const ids = JSON.parse(text)
const urls = ids.map((id) => ({ id, url: "https://api.example.com/v2/items/" + id }))
await Bun.write("urls.json", JSON.stringify(urls))
`

const REPORT = String.raw`const text = await Bun.file("urls.json").text().catch(() => undefined)
if (text === undefined) {
  console.error("urls.json is missing")
  process.exit(1)
}
const urls = JSON.parse(text)
const lines = urls.map((entry) => entry.id + " " + entry.url)
await Bun.write("report.txt", lines.join("\n") + "\n")
`

const plan = (seed: number): { raw: string; expected: string } => {
  const rng = mulberry32(seed)
  const ids = Array.from({ length: 9 }, (_, index) => "item-" + int(rng, 1000, 9999) + "-" + (index + 1))
  const expected = ids.map((id) => id + " https://api.example.com/v2/items/" + id).join("\n") + "\n"
  return { raw: ids.join("\n") + "\n", expected }
}

const runStep = async (m: Machine, file: string): Promise<void> => {
  const result = await run(m, ["bun", file])
  if (result.code !== 0) throw new Error(file + " failed: " + (result.stderr || result.stdout))
}

export const chainedJobs: Task = {
  id: "terminal-013-chained-jobs",
  track: "terminal",
  os: ["linux", "macos", "windows"],
  needs: [],
  heldOut: true,
  prompt: "The three steps in jobs/ are not wired up. Run them in the right order so report.txt is produced.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "raw.txt", plan(seed).raw)
    await writeText(m, "jobs/extract.ts", EXTRACT)
    await writeText(m, "jobs/resolve.ts", RESOLVE)
    await writeText(m, "jobs/report.ts", REPORT)
  },
  oracle: async (m) => {
    await runStep(m, "jobs/extract.ts")
    await runStep(m, "jobs/resolve.ts")
    await runStep(m, "jobs/report.ts")
  },
  check: async (m, seed) => verdict([await matchesFile(m, "report", "report.txt", plan(seed).expected)]),
}
