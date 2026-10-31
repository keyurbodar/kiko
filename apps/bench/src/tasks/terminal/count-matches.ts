import { join } from "node:path"

import type { Machine, Task, Verdict } from "../../types"

const LOG_LINES = [
  "ERROR disk full",
  "info starting",
  "ERROR timeout",
  "debug cache warm",
  "ERROR permission denied",
  "info shutting down",
  "warn retry scheduled",
  "debug done",
]

async function setupCount(m: Machine): Promise<void> {
  await m.writeText(join(m.workdir, "input.log"), `${LOG_LINES.join("\n")}\n`)
}

async function oracleCount(m: Machine): Promise<void> {
  await m.writeText(join(m.workdir, "count.txt"), "3\n")
}

async function checkCount(m: Machine): Promise<Verdict> {
  const text = await m.readText(join(m.workdir, "count.txt"))
  const found = text === undefined ? "no count.txt" : (text.match(/[0-9]+/)?.[0] ?? text.trim())
  const pass = found === "3"
  return {
    pass,
    checks: [{ name: "count.txt holds 3", pass, detail: `found ${JSON.stringify(found)}` }],
  }
}

export const countMatches: Task = {
  id: "terminal-025-count-matches",
  track: "terminal",
  os: ["macos", "windows", "linux"],
  needs: [],
  heldOut: false,
  prompt: "count the lines in input.log that contain the word ERROR and write just the number to count.txt",
  limits: { turns: 12, seconds: 180 },
  setup: setupCount,
  oracle: oracleCount,
  check: checkCount,
}
