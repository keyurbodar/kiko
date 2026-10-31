import type { Task } from "../../types"
import { bun, check, LIMITS, mulberry32, pick, readText, verdict, writeJson, writeText } from "../helpers"

const WORDS = ["cedar", "maple", "river", "harbor", "summit", "willow"]

interface Entry {
  readonly name: string
  readonly copy: boolean
}

const entries = (seed: number): Entry[] => {
  const word = pick(mulberry32(seed), WORDS)
  return [
    { name: `${word} report.txt`, copy: true },
    { name: `-report-${word}.txt`, copy: true },
    { name: `report\n${word}.txt`, copy: true },
    { name: "report.txt", copy: true },
    { name: `${word}-summary.txt`, copy: false },
    { name: `report-${word}.md`, copy: false },
    { name: `old report.txt.bak`, copy: false },
    { name: ` ${word}.txt`, copy: false },
  ]
}

const content = (name: string, index: number): string => `${index}:${name.replace(/\n/g, "\\n")}\n`

const LIST = `const fs = require("node:fs")
const path = require("node:path")
const names = fs.readdirSync("incoming")
console.log(JSON.stringify(names))`

export const oddFilenames: Task = {
  id: "terminal-113-odd-filenames",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt:
    'In incoming/ there are text files with awkward names. Copy every .txt file whose name contains "report" into out/, keeping each name exactly, and write how many you copied to count.txt.',
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    const plan = entries(seed)
    for (const [index, entry] of plan.entries())
      await writeText(m, `incoming/${entry.name}`, content(entry.name, index))
    await writeText(m, "incoming/.keep", "")
  },
  oracle: async (m) => {
    const code = `const fs = require("node:fs")
const path = require("node:path")
fs.mkdirSync("out", { recursive: true })
const names = fs.readdirSync("incoming").filter((name) => name.endsWith(".txt") && name.includes("report"))
for (const name of names) fs.copyFileSync(path.join("incoming", name), path.join("out", name))
fs.writeFileSync("count.txt", String(names.length) + "\\n")`
    const result = await bun(m, code)
    if (result.code !== 0) throw new Error(`copy failed: ${result.stderr || result.stdout}`)
  },
  check: async (m, seed) => {
    const plan = entries(seed)
    const wanted = plan
      .filter((entry) => entry.copy)
      .map((entry) => entry.name)
      .sort()
    const listing = await bun(m, LIST)
    let incoming: string[] = []
    try {
      incoming = JSON.parse(listing.stdout.trim()) as string[]
    } catch {}
    const outListing = await bun(
      m,
      `const fs = require("node:fs")
console.log(JSON.stringify(fs.existsSync("out") ? fs.readdirSync("out") : []))`,
    )
    let out: string[] = []
    try {
      out = JSON.parse(outListing.stdout.trim()) as string[]
    } catch {}
    const copied = out.sort()
    const contents = await Promise.all(
      wanted.map(async (name) => {
        const index = plan.findIndex((entry) => entry.name === name)
        const actual = await readText(m, `out/${name}`)
        return { name, ok: actual === content(name, index) }
      }),
    )
    const incomingIntact = plan.every((entry) => incoming.includes(entry.name))
    const count = (await readText(m, "count.txt"))?.trim() ?? ""
    return verdict([
      check(
        "copied the right files",
        JSON.stringify(copied) === JSON.stringify(wanted),
        `out/ had ${JSON.stringify(copied)}`,
      ),
      check(
        "contents kept",
        contents.every((entry) => entry.ok),
        `wrong content for ${JSON.stringify(contents.filter((entry) => !entry.ok).map((entry) => entry.name))}`,
      ),
      check("count matches", count === String(wanted.length), `count.txt was ${JSON.stringify(count)}`),
      check("sources kept", incomingIntact, `incoming/ had ${JSON.stringify(incoming)}`),
    ])
  },
}
