import { createHash } from "node:crypto"
import type { Task } from "../../types"
import { LIMITS, matchesFile, mulberry32, run, sample, verdict, writeJson, writeText } from "../helpers"

const FILES = [
  "data/alpha.txt",
  "data/beta.txt",
  "data/gamma.txt",
  "data/delta.txt",
  "data/epsilon.txt",
  "data/zeta.txt",
  "data/eta.txt",
  "data/theta.txt",
]
const WORDS = ["harbor", "copper", "signal", "garden", "meadow", "anchor"]

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")

const AUDIT = String.raw`const fs = require("node:fs")
const crypto = require("node:crypto")
const lines = fs.readFileSync("checksums.txt", "utf8").split("\n").filter(Boolean)
const bad = lines
  .map((line) => {
    const [hash, path] = line.split(/\s+/)
    return { hash, path }
  })
  .filter((entry) => crypto.createHash("sha256").update(fs.readFileSync(entry.path)).digest("hex") !== entry.hash)
  .map((entry) => entry.path)
  .sort()
fs.writeFileSync("bad.txt", bad.join("\n") + "\n")
`

const plan = (seed: number): { files: { path: string; content: string }[]; lines: string[]; expected: string } => {
  const rng = mulberry32(seed)
  const files = FILES.map((path, index) => ({
    path,
    content: "record " + (1000 + index) + " " + WORDS[index % WORDS.length]! + " " + seed + "\n",
  }))
  const bad = sample(rng, FILES, 2)
  const lines = files.map((file) => {
    const hash = bad.includes(file.path) ? sha256("tampered:" + file.path) : sha256(file.content)
    return hash + "  " + file.path
  })
  return { files, lines, expected: [...bad].sort().join("\n") + "\n" }
}

export const checksumAudit: Task = {
  id: "terminal-024-checksum-audit",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "Verify every file in data/ against checksums.txt. Write the relative paths of the files whose contents do not match to bad.txt, one per line, sorted.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const details = plan(seed)
    await writeJson(m, "request.json", {})
    for (const file of details.files) await writeText(m, file.path, file.content)
    await writeText(m, "checksums.txt", details.lines.join("\n") + "\n")
  },
  oracle: async (m) => {
    const result = await run(m, ["bun", "-e", AUDIT])
    if (result.code !== 0) throw new Error("audit failed: " + (result.stderr || result.stdout))
  },
  check: async (m, seed) => verdict([await matchesFile(m, "bad", "bad.txt", plan(seed).expected)]),
}
