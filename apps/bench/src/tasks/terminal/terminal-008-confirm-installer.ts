import type { Task } from "../../types"
import { check, LIMITS, mulberry32, readText, run, verdict, writeJson, writeText } from "../helpers"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const tokenFor = (seed: number): string => `install-${hex(mulberry32(seed), 24)}`

const installer = (token: string): string => `#!/usr/bin/env bash
read -r answer
if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
  mkdir -p app
  printf '%s\\n' ${JSON.stringify(token)} > app/installed.txt
else
  exit 1
fi
`

export const confirmInstaller: Task = {
  id: "terminal-008-confirm-installer",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  prompt: "Run ./install.sh and accept its prompt so the install completes.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "install.sh", installer(tokenFor(seed)))
    await run(m, ["chmod", "+x", "install.sh"])
  },
  oracle: async (m) => {
    await run(m, ["bash", "-c", "printf 'y\\n' | ./install.sh"])
  },
  check: async (m, seed) => {
    const token = tokenFor(seed)
    const installed = await readText(m, "app/installed.txt")
    return verdict([
      check("installed", installed?.trim() === token, `app/installed.txt was ${JSON.stringify(installed)}`),
    ])
  },
}
