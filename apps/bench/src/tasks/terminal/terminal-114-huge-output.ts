import type { Task } from "../../types"
import { bun, check, LIMITS, mulberry32, readText, verdict, writeJson, writeText } from "../helpers"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const tokenFor = (seed: number): string => `answer-${hex(mulberry32(seed), 20)}`

const DUMP = (token: string): string => `const marker = "ANSWER=" + ${JSON.stringify(token)}
let chunk = ""
for (let index = 0; index < 250000; index += 1) {
  chunk += index === 125000 ? marker + "\\n" : "payload-" + String(index).padStart(7, "0") + "-" + "x".repeat(180) + "\\n"
  if (chunk.length > 1000000) {
    process.stdout.write(chunk)
    chunk = ""
  }
}
process.stdout.write(chunk)
`

export const hugeOutput: Task = {
  id: "terminal-114-huge-output",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt:
    "Run ./dump.ts. Somewhere in its output is a line that starts with ANSWER=. Write the value after the = to answer.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "dump.ts", DUMP(tokenFor(seed)))
  },
  oracle: async (m) => {
    const code = `const child = Bun.spawn(["bun", "dump.ts"], { stdout: "pipe" })
const reader = child.stdout.getReader()
const decoder = new TextDecoder()
let carry = ""
let answer = ""
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  carry += decoder.decode(value, { stream: true })
  const lines = carry.split("\\n")
  carry = lines.pop() ?? ""
  const found = lines.find((line) => line.startsWith("ANSWER="))
  if (found) answer = found.slice("ANSWER=".length)
}
await child.exited
if (!answer) throw new Error("no ANSWER line in the output")
await Bun.write("answer.txt", answer + "\\n")
`
    const result = await bun(m, code, { timeoutMs: 180_000 })
    if (result.code !== 0) throw new Error(`could not read the output: ${result.stderr || result.stdout}`)
  },
  check: async (m, seed) => {
    const written = (await readText(m, "answer.txt"))?.trim() ?? ""
    return verdict([check("answer matches", written === tokenFor(seed), `answer.txt was ${JSON.stringify(written)}`)])
  },
}
