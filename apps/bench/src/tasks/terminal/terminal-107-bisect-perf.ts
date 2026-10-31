import type { Machine, Task } from "../../types"
import { bun, check, git, int, mulberry32, readText, verdict, writeJson, writeText } from "../helpers"

const LONG = { turns: 60, seconds: 1200 } as const
const COMMITS = 60

const DATA = `export const DATA: Array<[number, number]> = Array.from({ length: 200000 }, (_, index) => [index, (index * 37) % 9973])
`

const GOOD = `import { DATA } from "./data"

const index = new Map(DATA)

export const find = (id: number): number => index.get(id) ?? 0
`

const BAD = `import { DATA } from "./data"

export const find = (id: number): number => {
  for (const [key, value] of DATA) if (key === id) return value
  return 0
}
`

const BENCH = `import { find } from "./src/lookup"

const started = performance.now()
let sum = 0
for (let index = 0; index < 2000; index += 1) sum += find((index * 97) % 200000)
const elapsed = performance.now() - started
console.log(sum + " " + elapsed.toFixed(0) + "ms")
process.exit(elapsed < 300 ? 0 : 1)
`

const badIndex = (seed: number): number => int(mulberry32(seed), 25, 45)

const date = (second: number): string => `2026-01-01T00:00:${String(second).padStart(2, "0")}Z`

const commit = (m: Machine, message: string, second: number) =>
  git(m, ["commit", "-m", message], {
    env: { GIT_AUTHOR_DATE: date(second), GIT_COMMITTER_DATE: date(second), GIT_EDITOR: "true" },
  })

export const bisectPerf: Task = {
  id: "terminal-107-bisect-perf",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "long",
  prompt:
    "Lookup got slow somewhere in the last 60 commits. `bun bench.ts` is fast on the first commit and fails now. Find the first commit where it starts failing and write its full 40-character SHA to answer.txt. End the bisect and leave the tree clean.",
  limits: LONG,
  setup: async (m, seed) => {
    const bad = badIndex(seed)
    await writeJson(m, "request.json", { commits: COMMITS })
    await git(m, ["init", "-b", "main"])
    await git(m, ["config", "user.name", "Bench"])
    await git(m, ["config", "user.email", "bench@example.com"])
    await git(m, ["config", "core.autocrlf", "false"])
    await writeText(m, "src/data.ts", DATA)
    await writeText(m, "src/lookup.ts", GOOD)
    await writeText(m, "bench.ts", BENCH)
    await writeText(m, ".gitignore", "answer.txt\n")
    await git(m, ["add", "-A"])
    await commit(m, "Start the lookup index", 1)
    for (let index = 1; index < COMMITS; index += 1) {
      if (index === bad) await writeText(m, "src/lookup.ts", BAD)
      await writeText(m, `notes/c${String(index).padStart(2, "0")}.md`, `release note ${index}\n`)
      await git(m, ["add", "-A"])
      await commit(m, `Note ${index}`, index + 1)
    }
  },
  oracle: async (m) => {
    const first = (await git(m, ["rev-list", "--max-parents=0", "HEAD"])).stdout.trim()
    const start = await git(m, ["bisect", "start", "HEAD", first])
    if (start.code !== 0) throw new Error(`bisect start failed: ${start.stderr || start.stdout}`)
    const search = await git(m, ["bisect", "run", "bun", "bench.ts"], { timeoutMs: 300_000 })
    if (search.code !== 0) throw new Error(`bisect run failed: ${search.stderr || search.stdout}`)
    const bad = (await git(m, ["rev-parse", "refs/bisect/bad"])).stdout.trim()
    await writeText(m, "answer.txt", `${bad}\n`)
    await git(m, ["bisect", "reset"])
  },
  check: async (m, seed) => {
    const history = (await git(m, ["rev-list", "--reverse", "main"])).stdout.trim().split("\n")
    const expected = history[badIndex(seed)] ?? ""
    const answer = await readText(m, "answer.txt")
    const status = (await git(m, ["status", "--porcelain"])).stdout.trim()
    const marker = await git(m, ["rev-parse", "--verify", "BISECT_START"])
    const bench = await bun(
      m,
      `const { find } = await import("./src/lookup.ts")
console.log(find(12345))`,
    )
    return verdict([
      check("answer matches", answer?.trim() === expected, `answer.txt was ${JSON.stringify(answer)}`),
      check("bisect ended", marker.code !== 0, "BISECT_START still resolves"),
      check("clean tree", status === "", `git status --porcelain was ${JSON.stringify(status)}`),
      check("lookup intact", bench.code === 0, `src/lookup.ts did not run: ${bench.stderr.slice(-200)}`),
    ])
  },
}
