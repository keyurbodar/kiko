import type { Task } from "../../types"
import { check, LIMITS, mulberry32, readText, run, verdict, writeJson, writeText } from "../helpers"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const tokenFor = (seed: number): string => `deploy-${hex(mulberry32(seed), 20)}`

const deploy = (token: string): string => `#!/usr/bin/env bash
printf '%s\\n' ${JSON.stringify(token)} > deployed.txt
`

export const pathDeploy: Task = {
  id: "terminal-012-path-deploy",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "The deploy command is installed in bin/ but is not on your PATH. Make `deploy` run and let it write deployed.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "bin/deploy", deploy(tokenFor(seed)))
    await run(m, ["chmod", "+x", "bin/deploy"])
  },
  oracle: async (m) => {
    await run(m, ["bash", "-c", 'export PATH="$PWD/bin:$PATH"; deploy'])
  },
  check: async (m, seed) => {
    const token = tokenFor(seed)
    const deployed = await readText(m, "deployed.txt")
    return verdict([check("deployed", deployed?.trim() === token, `deployed.txt was ${JSON.stringify(deployed)}`)])
  },
}
