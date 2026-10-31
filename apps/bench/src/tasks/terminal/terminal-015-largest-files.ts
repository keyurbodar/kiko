import type { Task } from "../../types"
import { LIMITS, matchesFile, mulberry32, run, sample, verdict, writeJson, writeText } from "../helpers"

const PATHS = [
  "alpha.txt",
  "docs/readme.md",
  "docs/guides/setup.md",
  "docs/guides/deep/notes.txt",
  "images/logo.bin",
  "images/icons/a.bin",
  "images/icons/b.bin",
  "src/main.ts",
  "src/lib/util.ts",
  "src/lib/deep/impl.ts",
  "archive/old.zip",
  "archive/deeper/older.zip",
]

const WALK = String.raw`const fs = require("node:fs")
const path = require("node:path")
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [{ full, size: fs.statSync(full).size }]
  })
const files = walk("data").sort((left, right) => right.size - left.size)
const out = files.slice(0, 3).map((file) => path.relative(".", file.full).split(path.sep).join("/"))
fs.writeFileSync("largest.txt", out.join("\n") + "\n")
`

const plan = (seed: number): { files: { path: string; size: number }[]; expected: string } => {
  const rng = mulberry32(seed)
  const sizes = PATHS.map((_, index) => 140 + index * 113 + (seed % 29))
  const shuffled = sample(rng, sizes, sizes.length)
  const files = PATHS.map((path, index) => ({ path, size: shuffled[index]! }))
  const expected =
    [...files]
      .sort((left, right) => right.size - left.size)
      .slice(0, 3)
      .map((file) => "data/" + file.path)
      .join("\n") + "\n"
  return { files, expected }
}

export const largestFiles: Task = {
  id: "terminal-015-largest-files",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "Write the relative paths of the three largest files under data/ to largest.txt, largest first, one per line, using forward slashes.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    for (const file of plan(seed).files) await writeText(m, "data/" + file.path, "x".repeat(file.size))
  },
  oracle: async (m) => {
    const result = await run(m, ["bun", "-e", WALK])
    if (result.code !== 0) throw new Error("walk failed: " + (result.stderr || result.stdout))
  },
  check: async (m, seed) => verdict([await matchesFile(m, "largest", "largest.txt", plan(seed).expected)]),
}
