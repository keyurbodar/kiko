import type { Machine, Task } from "../../types"
import { at, bun, check, git, LIMITS, matchesFile, mulberry32, pick, verdict, writeJson, writeText } from "../helpers"

const WORDS = ["cedar", "maple", "river", "harbor", "summit", "willow", "falcon", "meadow"]

const name = (seed: number): string => pick(mulberry32(seed), WORDS)

const initial = (word: string): string => `version=1\nmode=slow\nname=${word}\n`

const feature = (word: string): string => `version=3\nmode=fast\nname=${word}\n`

const main = (word: string): string => `version=2\nmode=slow\nname=${word}\n`

const resolved = (word: string): string => `version=2\nmode=fast\nname=${word}\n`

const date = (second: number): string => `2026-01-01T00:00:${String(second).padStart(2, "0")}Z`

const commit = (m: Machine, message: string, second: number) =>
  git(m, ["commit", "-m", message], {
    env: { GIT_AUTHOR_DATE: date(second), GIT_COMMITTER_DATE: date(second), GIT_EDITOR: "true" },
  })

export const gitRebaseConflict: Task = {
  id: "terminal-003-git-rebase-conflict",
  track: "terminal",
  os: ["linux", "macos", "windows"],
  needs: [],
  heldOut: false,
  prompt:
    "Rebase feature onto main and resolve the conflict in config.txt by keeping version 2 from main and mode=fast from the feature. Leave feature checked out with a clean working tree.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const word = name(seed)
    await writeJson(m, "request.json", {})
    await git(m, ["init", "-b", "main"])
    await git(m, ["config", "user.name", "Bench"])
    await git(m, ["config", "user.email", "bench@example.com"])
    await git(m, ["config", "core.autocrlf", "false"])
    await writeText(m, "config.txt", initial(word))
    await git(m, ["add", "-A"])
    await commit(m, "Initial config", 1)
    await git(m, ["checkout", "-b", "feature"])
    await writeText(m, "config.txt", feature(word))
    await git(m, ["add", "-A"])
    await commit(m, "Speed up mode", 2)
    await git(m, ["checkout", "main"])
    await writeText(m, "config.txt", main(word))
    await git(m, ["add", "-A"])
    await commit(m, "Bump version", 3)
    await git(m, ["checkout", "feature"])
  },
  oracle: async (m, seed) => {
    const word = name(seed)
    await git(m, ["rebase", "main"])
    await writeText(m, "config.txt", resolved(word))
    await git(m, ["add", "config.txt"])
    await git(m, ["-c", "core.editor=true", "rebase", "--continue"], { env: { GIT_EDITOR: "true" } })
  },
  check: async (m, seed) => {
    const word = name(seed)
    const branch = (await git(m, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
    const status = (await git(m, ["status", "--porcelain"])).stdout.trim()
    const subjects = (await git(m, ["log", "--format=%s"])).stdout.trim().split("\n")
    const rebase = await bun(
      m,
      `process.exit(require("node:fs").existsSync(${JSON.stringify(at(m, ".git", "rebase-merge"))}) ? 0 : 1)`,
    )
    return verdict([
      check("on feature", branch === "feature", `HEAD was ${JSON.stringify(branch)}`),
      check("clean tree", status === "", `git status --porcelain was ${JSON.stringify(status)}`),
      check("no rebase in progress", rebase.code !== 0, `rebase-merge exists: ${rebase.code === 0}`),
      await matchesFile(m, "config resolved", "config.txt", resolved(word)),
      check(
        "linear history",
        subjects.length === 3 && subjects[0] === "Speed up mode" && subjects[1] === "Bump version",
        `subjects were ${JSON.stringify(subjects)}`,
      ),
    ])
  },
}
