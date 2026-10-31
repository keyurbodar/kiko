import type { Task } from "../../types"
import { int, LIMITS, matchesFile, mulberry32, pick, run, verdict, writeJson, writeText } from "../helpers"

const WORDS = ["harbor", "copper", "signal", "garden", "meadow", "anchor"]

const token = (seed: number): string => {
  const rng = mulberry32(seed)
  return "artifact-" + int(rng, 100000, 999999) + "-" + pick(rng, WORDS)
}

const BROKEN = [
  ".PHONY: test build",
  "",
  "test:",
  '\t@echo "tests pass"',
  "",
  "build: prepare",
  "\t@mkdir -p dist",
  "\t@cp src/main.txt dist/artifact.txt",
  "",
].join("\n")

const FIXED = [
  ".PHONY: test build prepare",
  "",
  "test:",
  '\t@echo "tests pass"',
  "",
  "prepare:",
  "\t@mkdir -p dist",
  "",
  "build: prepare",
  "\t@cp src/main.txt dist/artifact.txt",
  "",
].join("\n")

export const makefileTarget: Task = {
  id: "terminal-021-makefile-target",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  prompt:
    "`make build` fails. Fix the Makefile so it produces dist/artifact.txt containing the token from src/main.txt, then run it.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "src/main.txt", token(seed) + "\n")
    await writeText(m, "Makefile", BROKEN)
  },
  oracle: async (m) => {
    await writeText(m, "Makefile", FIXED)
    const built = await run(m, ["make", "build"])
    if (built.code !== 0) throw new Error("make build failed: " + (built.stderr || built.stdout))
  },
  check: async (m, seed) => verdict([await matchesFile(m, "artifact", "dist/artifact.txt", token(seed))]),
}
