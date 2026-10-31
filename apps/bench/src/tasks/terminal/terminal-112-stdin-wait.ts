import type { Task } from "../../types"
import { check, mulberry32, readText, run, verdict, writeJson, writeText } from "../helpers"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const tokenFor = (seed: number): string => `deploy-${hex(mulberry32(seed), 20)}`

const DEPLOY = (token: string): string => `#!/usr/bin/env bash
read -r confirmation
printf '%s\\n' ${JSON.stringify(token)} > deployed.txt
`

export const stdinWait: Task = {
  id: "terminal-112-stdin-wait",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt: "Run ./deploy.sh so it finishes and writes deployed.txt.",
  limits: { turns: 20, seconds: 180 },
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "deploy.sh", DEPLOY(tokenFor(seed)))
    await run(m, ["chmod", "+x", "deploy.sh"])
  },
  oracle: async (m) => {
    const result = await run(m, ["bash", "-c", "./deploy.sh < /dev/null"], { timeoutMs: 30_000 })
    if (result.code !== 0) throw new Error(`deploy failed: ${result.stderr || result.stdout}`)
  },
  check: async (m, seed) => {
    const deployed = await readText(m, "deployed.txt")
    return verdict([
      check("deployed", deployed?.trim() === tokenFor(seed), `deployed.txt was ${JSON.stringify(deployed)}`),
    ])
  },
}
