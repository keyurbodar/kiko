import type { Task } from "../../types"
import { int, LIMITS, matchesFile, mulberry32, pick, run, verdict, writeJson, writeText } from "../helpers"

const MODES = ["staging", "canary", "edge", "review"]
const WORDS = ["harbor", "copper", "signal", "garden", "meadow", "anchor"]

const plan = (seed: number): { mode: string; token: string } => {
  const rng = mulberry32(seed)
  return {
    mode: pick(rng, MODES),
    token: "build-" + int(rng, 100000, 999999) + "-" + pick(rng, WORDS),
  }
}

const BUILD = String.raw`import { mkdirSync, writeFileSync } from "node:fs"

const mode = process.env.BUILD_MODE
if (!mode) {
  console.log("BUILD_MODE is not set")
  process.exit(1)
}
mkdirSync("dist", { recursive: true })
writeFileSync("dist/mode.txt", mode + " " + TOKEN + "\n")
`

const buildScript = (seed: number): string => BUILD.replace("TOKEN", JSON.stringify(plan(seed).token))

export const buildMode: Task = {
  id: "terminal-023-build-mode",
  track: "terminal",
  os: ["linux", "macos", "windows"],
  needs: [],
  heldOut: false,
  prompt: "The build fails because a setting is missing. Run it in the mode in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", { mode: plan(seed).mode })
    await writeText(m, "build.ts", buildScript(seed))
  },
  oracle: async (m, seed) => {
    const result = await run(m, ["bun", "build.ts"], { env: { BUILD_MODE: plan(seed).mode } })
    if (result.code !== 0) throw new Error("build failed: " + (result.stderr || result.stdout))
  },
  check: async (m, seed) => {
    const details = plan(seed)
    return verdict([await matchesFile(m, "mode", "dist/mode.txt", details.mode + " " + details.token)])
  },
}
