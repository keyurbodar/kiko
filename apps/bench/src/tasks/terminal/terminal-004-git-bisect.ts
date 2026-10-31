import type { Machine, Task } from "../../types"
import { check, git, LIMITS, readText, verdict, writeJson, writeText } from "../helpers"

const CHECK = `const text = (await Bun.file("state.txt").text()).trim()
process.exit(text.split(" ")[0] === "ok" ? 0 : 1)
`

const date = (second: number): string => `2026-01-01T00:00:${String(second).padStart(2, "0")}Z`

const commit = (m: Machine, message: string, second: number) =>
  git(m, ["commit", "-m", message], {
    env: { GIT_AUTHOR_DATE: date(second), GIT_COMMITTER_DATE: date(second), GIT_EDITOR: "true" },
  })

const state = (index: number): string => `${index <= 8 ? "ok" : "broken"} ${index}\n`

export const gitBisect: Task = {
  id: "terminal-004-git-bisect",
  track: "terminal",
  os: ["linux", "macos", "windows"],
  needs: [],
  heldOut: true,
  prompt:
    "Something broke between the first commit and HEAD. Find the first commit where `bun check.ts` fails and write its full 40-character SHA to answer.txt. End the bisect and leave the working tree clean.",
  limits: LIMITS,
  setup: async (m) => {
    await writeJson(m, "request.json", {})
    await git(m, ["init", "-b", "main"])
    await git(m, ["config", "user.name", "Bench"])
    await git(m, ["config", "user.email", "bench@example.com"])
    await git(m, ["config", "core.autocrlf", "false"])
    await writeText(m, "check.ts", CHECK)
    await writeText(m, ".gitignore", "answer.txt\n")
    await writeText(m, "state.txt", state(1))
    await git(m, ["add", "-A"])
    await commit(m, "commit 1", 1)
    for (let index = 2; index <= 14; index += 1) {
      await writeText(m, "state.txt", state(index))
      await git(m, ["add", "-A"])
      await commit(m, `commit ${index}`, index)
    }
  },
  oracle: async (m) => {
    const first = (await git(m, ["rev-list", "--max-parents=0", "HEAD"])).stdout.trim()
    await git(m, ["bisect", "start", "HEAD", first])
    const search = await git(m, ["bisect", "run", "bun", "check.ts"], { timeoutMs: 120_000 })
    if (search.code !== 0) throw new Error(`git bisect run failed: ${search.stderr || search.stdout}`)
    const bad = (await git(m, ["rev-parse", "refs/bisect/bad"])).stdout.trim()
    await writeText(m, "answer.txt", `${bad}\n`)
    await git(m, ["bisect", "reset"])
  },
  check: async (m) => {
    const history = (await git(m, ["rev-list", "--reverse", "main"])).stdout.trim().split("\n")
    const expected = history[8] ?? ""
    const answer = await readText(m, "answer.txt")
    const status = (await git(m, ["status", "--porcelain"])).stdout.trim()
    const marker = await git(m, ["rev-parse", "--verify", "BISECT_START"])
    return verdict([
      check("answer matches", answer?.trim() === expected, `answer.txt was ${JSON.stringify(answer)}`),
      check("bisect ended", marker.code !== 0, `BISECT_START still resolves: ${JSON.stringify(marker.stdout.trim())}`),
      check("clean tree", status === "", `git status --porcelain was ${JSON.stringify(status)}`),
    ])
  },
}
