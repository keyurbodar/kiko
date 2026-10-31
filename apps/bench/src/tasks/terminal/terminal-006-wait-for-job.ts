import type { Task } from "../../types"
import {
  check,
  LIMITS,
  mulberry32,
  readText,
  spawnTracked,
  verdict,
  waitForFile,
  writeJson,
  writeText,
} from "../helpers"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const tokenFor = (seed: number): string => `job-${hex(mulberry32(seed), 24)}`

const job = (token: string): string => `import { mkdir, writeFile } from "node:fs/promises"

await new Promise((resolve) => setTimeout(resolve, 2000))
await mkdir("build", { recursive: true })
await writeFile("build/finished.txt", ${JSON.stringify(`${token}\n`)})
`

export const waitForJob: Task = {
  id: "terminal-006-wait-for-job",
  track: "terminal",
  os: ["linux", "macos", "windows"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "A build is running in the background. Wait for it to finish, then copy the token from build/finished.txt into result.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "job.ts", job(tokenFor(seed)))
    await spawnTracked(m, ["bun", "job.ts"])
  },
  oracle: async (m) => {
    await waitForFile(m, "build/finished.txt")
    const token = (await readText(m, "build/finished.txt"))?.trim() ?? ""
    await writeText(m, "result.txt", `${token}\n`)
  },
  check: async (m, seed) => {
    const token = tokenFor(seed)
    const result = await readText(m, "result.txt")
    return verdict([check("result matches", result?.trim() === token, `result.txt was ${JSON.stringify(result)}`)])
  },
}
