import type { Machine, Task } from "../../types"
import { check, git, LIMITS, mulberry32, pick, readText, verdict, writeJson, writeText } from "../helpers"

const FEATURES = ["export", "webhook", "calendar", "invoice", "gallery", "search"]
const WORDS = ["retry", "timeout", "encoding", "batching", "caching", "logging"]

const date = (second: number): string => `2026-01-01T00:00:${String(second).padStart(2, "0")}Z`

const commit = (m: Machine, message: string, second: number) =>
  git(m, ["commit", "-m", message], {
    env: { GIT_AUTHOR_DATE: date(second), GIT_COMMITTER_DATE: date(second), GIT_EDITOR: "true" },
  })

const details = (seed: number): { readonly feature: string; readonly message: string } => {
  const rng = mulberry32(seed)
  const feature = pick(rng, FEATURES)
  const word = pick(rng, WORDS)
  return { feature, message: `Fix ${word} handling` }
}

export const gitCherryPick: Task = {
  id: "terminal-005-git-cherry-pick",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt: "Cherry-pick the commit titled in request.json from branch release onto main. Do not bring the other commit.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { feature, message } = details(seed)
    await writeJson(m, "request.json", { message })
    await git(m, ["init", "-b", "main"])
    await git(m, ["config", "user.name", "Bench"])
    await git(m, ["config", "user.email", "bench@example.com"])
    await git(m, ["config", "core.autocrlf", "false"])
    await writeText(m, "readme.txt", "release notes\n")
    await git(m, ["add", "-A"])
    await commit(m, "Initial notes", 1)
    await git(m, ["checkout", "-b", "release"])
    await writeText(m, "feature.ts", `export const feature = ${JSON.stringify(feature)}\n`)
    await git(m, ["add", "-A"])
    await commit(m, `Add ${feature} support`, 2)
    await writeText(m, "readme.txt", `release notes\n${message}\n`)
    await git(m, ["add", "-A"])
    await commit(m, message, 3)
    await git(m, ["checkout", "main"])
  },
  oracle: async (m) => {
    const sha = (await git(m, ["rev-parse", "release"])).stdout.trim()
    await git(m, ["cherry-pick", sha])
  },
  check: async (m, seed) => {
    const { message } = details(seed)
    const branch = (await git(m, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
    const subjects = (await git(m, ["log", "--format=%s"])).stdout.trim().split("\n")
    const readme = (await readText(m, "readme.txt")) ?? ""
    const feature = await readText(m, "feature.ts")
    const status = (await git(m, ["status", "--porcelain"])).stdout.trim()
    return verdict([
      check("on main", branch === "main", `HEAD was ${JSON.stringify(branch)}`),
      check("commit present", subjects.includes(message), `subjects were ${JSON.stringify(subjects)}`),
      check("readme has fix", readme.includes(message), `readme.txt was ${JSON.stringify(readme)}`),
      check("feature not picked", feature === undefined, `feature.ts was ${JSON.stringify(feature)}`),
      check("clean tree", status === "", `git status --porcelain was ${JSON.stringify(status)}`),
    ])
  },
}
