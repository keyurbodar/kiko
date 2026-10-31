import type { Task } from "../../types"
import { int, LIMITS, matchesFile, mulberry32, pick, run, verdict, writeJson, writeText } from "../helpers"

const WORDS = ["amber", "basalt", "cinder", "dune", "ember", "fjord"]

const token = (seed: number): string => {
  const rng = mulberry32(seed)
  return "run-" + int(rng, 100000, 999999) + "-" + pick(rng, WORDS)
}

export const fixPermissions: Task = {
  id: "terminal-017-fix-permissions",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  prompt: "./run.sh fails with permission denied. Make it executable and run it.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "run.sh", "#!/bin/sh\nprintf '%s\\n' '" + token(seed) + "' > ran.txt\n")
    const mode = await run(m, ["chmod", "644", "run.sh"])
    if (mode.code !== 0) throw new Error("chmod failed: " + (mode.stderr || mode.stdout))
  },
  oracle: async (m) => {
    const mode = await run(m, ["chmod", "+x", "run.sh"])
    if (mode.code !== 0) throw new Error("chmod failed: " + (mode.stderr || mode.stdout))
    const executed = await run(m, ["./run.sh"])
    if (executed.code !== 0) throw new Error("run.sh failed: " + (executed.stderr || executed.stdout))
  },
  check: async (m, seed) => verdict([await matchesFile(m, "ran", "ran.txt", token(seed))]),
}
