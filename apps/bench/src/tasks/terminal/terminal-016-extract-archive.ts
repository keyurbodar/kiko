import type { Task } from "../../types"
import {
  bun,
  int,
  LIMITS,
  matchesFile,
  mulberry32,
  pick,
  readText,
  run,
  verdict,
  writeJson,
  writeText,
} from "../helpers"

const WORDS = ["harbor", "copper", "signal", "garden", "meadow", "anchor"]

const token = (seed: number): string => {
  const rng = mulberry32(seed)
  return "kiko-" + int(rng, 100000, 999999) + "-" + pick(rng, WORDS)
}

export const extractArchive: Task = {
  id: "terminal-016-extract-archive",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt: "Extract archive.tar.gz and write the contents of the secret.txt inside it to answer.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "staging/docs/readme.txt", "Read me first.\n")
    await writeText(m, "staging/docs/secret.txt", token(seed) + "\n")
    await writeText(m, "staging/images/decoy.txt", "not this one\n")
    const packed = await run(m, ["tar", "-czf", "archive.tar.gz", "-C", "staging", "."])
    if (packed.code !== 0) throw new Error("tar failed: " + (packed.stderr || packed.stdout))
    const removed = await bun(m, 'require("node:fs").rmSync("staging", { recursive: true, force: true })')
    if (removed.code !== 0) throw new Error("cleanup failed: " + (removed.stderr || removed.stdout))
  },
  oracle: async (m) => {
    const made = await bun(m, 'require("node:fs").mkdirSync("out", { recursive: true })')
    if (made.code !== 0) throw new Error("mkdir failed: " + (made.stderr || made.stdout))
    const unpacked = await run(m, ["tar", "-xzf", "archive.tar.gz", "-C", "out"])
    if (unpacked.code !== 0) throw new Error("tar failed: " + (unpacked.stderr || unpacked.stdout))
    const secret = await readText(m, "out/docs/secret.txt")
    if (secret === undefined) throw new Error("out/docs/secret.txt is missing")
    await writeText(m, "answer.txt", secret)
  },
  check: async (m, seed) => verdict([await matchesFile(m, "answer", "answer.txt", token(seed))]),
}
