import type { Task } from "../../types"
import { bun, check, LIMITS, mulberry32, readText, verdict, writeJson, writeText } from "../helpers"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const tokens = (seed: number): { answer: string; decoys: string[] } => {
  const rng = mulberry32(seed)
  return {
    answer: `tok-${hex(rng, 24)}`,
    decoys: Array.from({ length: 40 }, () => `tok-${hex(rng, 24)}`),
  }
}

const BUILD = (seed: number): string => {
  const { answer, decoys } = tokens(seed)
  return `const answer = ${JSON.stringify(answer)}
const decoys = ${JSON.stringify(decoys)}
let frame = ""
for (let index = 0; index < decoys.length; index += 1) {
  const percent = Math.round(((index + 1) / decoys.length) * 99)
  frame += "\\r\\u001b[32mprogress " + percent + "%\\u001b[0m nonce=" + decoys[index]
  process.stdout.write(frame)
  frame = ""
}
process.stdout.write("\\r\\u001b[1mprogress 100%\\u001b[0m token=" + answer + "\\n")
`
}

export const progressFinalFrame: Task = {
  id: "terminal-110-progress-final-frame",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt:
    "Run build.ts. It redraws a progress bar in place and the finished line carries a token. Write that token to answer.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "build.ts", BUILD(seed))
  },
  oracle: async (m) => {
    const code = `const child = Bun.spawn(["bun", "build.ts"], { stdout: "pipe" })
const text = await new Response(child.stdout).text()
const line = text.split("\\r").filter((part) => part.includes("token=")).pop() ?? ""
const token = line.slice(line.indexOf("token=") + 6).trim()
await Bun.write("answer.txt", token + "\\n")
`
    const result = await bun(m, code)
    if (result.code !== 0) throw new Error(`could not read the build output: ${result.stderr || result.stdout}`)
  },
  check: async (m, seed) => {
    const { answer, decoys } = tokens(seed)
    const written = (await readText(m, "answer.txt"))?.trim() ?? ""
    return verdict([
      check("token matches", written === answer, `answer.txt was ${JSON.stringify(written)}`),
      check("not a stale frame", !decoys.includes(written), "answer.txt holds a frame nonce"),
    ])
  },
}
