import type { Task } from "../../types"
import { bun, check, LIMITS, mulberry32, readText, run, verdict, writeJson, writeText } from "../helpers"

const LONG = { turns: 60, seconds: 1200 } as const

const SPEC = `# wc2

Count lines, words, bytes and characters.

    bin/wc2 [OPTIONS] [FILE]

Read FILE, or standard input when FILE is omitted or is \`-\`.

Options:

- \`-l\` lines: the number of newline characters
- \`-w\` words: runs of non-whitespace separated by whitespace
- \`-c\` bytes: the number of UTF-8 bytes
- \`-m\` characters: the number of Unicode code points

Flags may be combined, for example \`-lw\`. With no flags, print all four.
Print the selected counts in the order lines, words, bytes, characters,
separated by single spaces, followed by a newline.

Exit with status 2 on an unknown flag, more than one FILE, or an unreadable
file, and write a message to standard error. Exit 0 otherwise.
`

const IMPLEMENTATION = `#!/usr/bin/env bun
const fs = require("node:fs")
const args = process.argv.slice(2)
const flags = []
let file
for (const arg of args) {
  if (arg === "-") {
    file = "-"
  } else if (arg.startsWith("-") && arg.length > 1) {
    for (const flag of arg.slice(1)) {
      if (!"lwcm".includes(flag)) {
        console.error("wc2: unknown option " + arg)
        process.exit(2)
      }
      flags.push(flag)
    }
  } else if (file === undefined) {
    file = arg
  } else {
    console.error("wc2: too many files")
    process.exit(2)
  }
}
const selected = flags.length === 0 ? ["l", "w", "c", "m"] : flags
let data
try {
  data = file === undefined || file === "-" ? fs.readFileSync(0) : fs.readFileSync(file)
} catch {
  console.error("wc2: cannot read " + file)
  process.exit(2)
}
const text = data.toString("utf8")
const counts = {
  l: (text.match(/\\n/g) || []).length,
  w: text.split(/\\s+/).filter(Boolean).length,
  c: data.length,
  m: [...text].length,
}
console.log(["l", "w", "c", "m"].filter((flag) => selected.includes(flag)).map((flag) => counts[flag]).join(" "))
`

interface Case {
  readonly name: string
  readonly path?: string
  readonly content?: string
  readonly args: readonly string[]
  readonly stdin?: string
  readonly code: number
  readonly out: string
}

const count = (text: string): Record<string, number> => ({
  l: (text.match(/\n/g) ?? []).length,
  w: text.split(/\s+/).filter(Boolean).length,
  c: Buffer.byteLength(text),
  m: [...text].length,
})

const line = (text: string, flags: string): string => [...flags].map((flag) => count(text)[flag] ?? 0).join(" ")

const cases = (seed: number): Case[] => {
  const rng = mulberry32(seed)
  const pickOne = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!
  const word = (): string => pickOne(["alpha", "beta", "gamma", "héllo", "wörld", "日本語", "x"])
  const sentence = (words: number, trailing: boolean): string =>
    `${Array.from({ length: words }, word).join(" ")}${trailing ? "\n" : ""}`
  const first = sentence(2 + Math.floor(rng() * 4), true)
  const second = sentence(1 + Math.floor(rng() * 3), true)
  const third = sentence(1 + Math.floor(rng() * 3), false)
  return [
    { name: "defaults", path: "a.txt", content: first, args: ["a.txt"], code: 0, out: line(first, "lwcm") },
    { name: "lines", path: "b.txt", content: second, args: ["-l", "b.txt"], code: 0, out: line(second, "l") },
    { name: "words", path: "c.txt", content: third, args: ["-w", "c.txt"], code: 0, out: line(third, "w") },
    { name: "bytes", path: "d.txt", content: first, args: ["-c", "d.txt"], code: 0, out: line(first, "c") },
    { name: "characters", path: "e.txt", content: second, args: ["-m", "e.txt"], code: 0, out: line(second, "m") },
    { name: "combined", path: "f.txt", content: third, args: ["-wm", "f.txt"], code: 0, out: line(third, "wm") },
    { name: "canonical order", path: "g.txt", content: first, args: ["-ml", "g.txt"], code: 0, out: line(first, "lm") },
    { name: "empty", path: "h.txt", content: "", args: ["h.txt"], code: 0, out: "0 0 0 0" },
    { name: "stdin dash", args: ["-w", "-"], stdin: third, code: 0, out: line(third, "w") },
    { name: "stdin omitted", args: [], stdin: second, code: 0, out: line(second, "lwcm") },
    { name: "missing file", args: ["absent.txt"], code: 2, out: "" },
    { name: "unknown flag", path: "a.txt", content: first, args: ["-q", "a.txt"], code: 2, out: "" },
  ]
}

const RUNNER = (input: readonly Case[]): string => `const cases = ${JSON.stringify(input)}
const results = []
for (const item of cases) {
  if (item.path !== undefined) await Bun.write(item.path, item.content)
  const stdin = item.stdin === undefined ? "ignore" : new TextEncoder().encode(item.stdin)
  const proc = Bun.spawnSync(["./bin/wc2", ...item.args], { stdin, stdout: "pipe", stderr: "pipe" })
  results.push({ code: proc.exitCode, out: proc.stdout.toString().trim() })
}
console.log(JSON.stringify(results))
`

export const cliFromSpec: Task = {
  id: "terminal-106-cli-from-spec",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "long",
  prompt:
    "Build the command described in SPEC.md at bin/wc2. It has to be executable and handle every case in the spec, including standard input and bad arguments. Nothing is installed for you beyond the tools already on this machine.",
  limits: LONG,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", { seed })
    await writeText(m, "SPEC.md", SPEC)
    await writeText(m, "bin/.keep", "")
  },
  oracle: async (m) => {
    await writeText(m, "bin/wc2", IMPLEMENTATION)
    await run(m, ["chmod", "+x", "bin/wc2"])
  },
  check: async (m, seed) => {
    const input = cases(seed)
    const result = await bun(m, RUNNER(input))
    let actual: Array<{ code: number; out: string }> = []
    try {
      actual = JSON.parse(result.stdout.trim()) as Array<{ code: number; out: string }>
    } catch {}
    const failures = input
      .map((item, index) => ({ item, got: actual[index] }))
      .filter(({ item, got }) => !got || got.code !== item.code || got.out !== item.out)
      .map(
        ({ item, got }) =>
          `${item.name}: expected ${item.code} ${JSON.stringify(item.out)}, got ${JSON.stringify(got)}`,
      )
    const spec = await readText(m, "SPEC.md")
    return verdict([
      check("hidden cases pass", failures.length === 0, failures.join("; ") || "all cases passed"),
      check("spec untouched", spec === SPEC, "SPEC.md changed"),
    ])
  },
}
