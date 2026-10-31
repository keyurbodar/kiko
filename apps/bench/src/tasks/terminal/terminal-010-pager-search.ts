import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, readText, run, verdict, writeJson, writeText } from "../helpers"

const TOTAL = 5000

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const plan = (seed: number): { readonly lines: string[]; readonly target: string } => {
  const rng = mulberry32(seed)
  const token = `req-${hex(rng, 20)}`
  const index = int(rng, 0, TOTAL - 1)
  const lines = Array.from({ length: TOTAL }, (_, line) =>
    line === index
      ? `${line + 1}: INFO handled REQUEST=${token} status=200`
      : `${line + 1}: INFO event=heartbeat status=200`,
  )
  return { lines, target: lines[index] ?? "" }
}

export const pagerSearch: Task = {
  id: "terminal-010-pager-search",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt: "The request id is buried in big.log. Write the whole line that contains REQUEST= to answer.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { lines } = plan(seed)
    await writeJson(m, "request.json", {})
    await writeText(m, "big.log", `${lines.join("\n")}\n`)
  },
  oracle: async (m) => {
    await run(m, ["bash", "-c", "grep REQUEST= big.log > answer.txt"])
  },
  check: async (m, seed) => {
    const { target } = plan(seed)
    const answer = await readText(m, "answer.txt")
    return verdict([check("answer matches", answer?.trim() === target, `answer.txt was ${JSON.stringify(answer)}`)])
  },
}
