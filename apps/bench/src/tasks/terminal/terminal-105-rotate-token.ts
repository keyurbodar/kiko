import type { Machine, Task } from "../../types"
import { at, bun, check, git, LIMITS, mulberry32, readText, run, verdict, writeJson, writeText } from "../helpers"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const tokens = (seed: number): { old: string; fresh: string } => {
  const rng = mulberry32(seed)
  return { old: `sk_live_${hex(rng, 24)}`, fresh: `sk_live_${hex(rng, 24)}` }
}

const FILES = ["config/app.json", "config/worker.json", "deploy/env", "scripts/setup.sh"]

const MESSAGES = [
  "Add the app config",
  "Add the worker config",
  "Add the a module",
  "Add the deploy env",
  "Add the b module",
  "Add the setup script",
  "Add the c module",
  "Record the retry count",
]

const appConfig = (token: string, retries?: number): string =>
  `${JSON.stringify({ token, name: "app", ...(retries === undefined ? {} : { retries }) }, null, 2)}\n`

const REWRITE = String.raw`const chunks = []
for await (const chunk of Bun.stdin.stream()) chunks.push(chunk)
const text = Buffer.concat(chunks).toString("utf8")
process.stdout.write(text.split(process.env.OLD_TOKEN).join(process.env.NEW_TOKEN))
`

const date = (second: number): string => `2026-01-01T00:00:${String(second).padStart(2, "0")}Z`

const commit = (m: Machine, message: string, second: number) =>
  git(m, ["commit", "-m", message], {
    env: { GIT_AUTHOR_DATE: date(second), GIT_COMMITTER_DATE: date(second), GIT_EDITOR: "true" },
  })

export const rotateToken: Task = {
  id: "terminal-105-rotate-token",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "Our API token leaked into this repository. The replacement token is in request.json. Rotate it everywhere the old token appears, including every commit, so the old value is nowhere in the repository. Keep the commits and their messages exactly as they are.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { old } = tokens(seed)
    await writeJson(m, "request.json", { token: tokens(seed).fresh })
    await git(m, ["init", "-b", "main"])
    await git(m, ["config", "user.name", "Bench"])
    await git(m, ["config", "user.email", "bench@example.com"])
    await git(m, ["config", "core.autocrlf", "false"])
    await writeText(m, "config/app.json", appConfig(old))
    await git(m, ["add", "-A"])
    await commit(m, "Add the app config", 1)
    await writeText(m, "config/worker.json", `${JSON.stringify({ token: old, workers: 3 }, null, 2)}\n`)
    await git(m, ["add", "-A"])
    await commit(m, "Add the worker config", 2)
    await writeText(m, "src/a.ts", "export const a = 1\n")
    await git(m, ["add", "-A"])
    await commit(m, "Add the a module", 3)
    await writeText(m, "deploy/env", `API_TOKEN=${old}\nREGION=eu\n`)
    await git(m, ["add", "-A"])
    await commit(m, "Add the deploy env", 4)
    await writeText(m, "src/b.ts", "export const b = 2\n")
    await git(m, ["add", "-A"])
    await commit(m, "Add the b module", 5)
    await writeText(m, "scripts/setup.sh", `#!/bin/sh\nexport API_TOKEN=${old}\n`)
    await git(m, ["add", "-A"])
    await commit(m, "Add the setup script", 6)
    await writeText(m, "src/c.ts", "export const c = 3\n")
    await git(m, ["add", "-A"])
    await commit(m, "Add the c module", 7)
    await writeText(m, "config/app.json", appConfig(old, 2))
    await git(m, ["add", "-A"])
    await commit(m, "Record the retry count", 8)
  },
  oracle: async (m, seed) => {
    const { old, fresh } = tokens(seed)
    const script = at(m, "..", `kiko-rewrite-${seed}.ts`)
    await m.writeText(script, REWRITE)
    const rewritten = await run(
      m,
      ["bash", "-c", `git fast-export --all | bun ${JSON.stringify(script)} | git fast-import --force`],
      { env: { OLD_TOKEN: old, NEW_TOKEN: fresh }, timeoutMs: 120_000 },
    )
    if (rewritten.code !== 0) throw new Error(`history rewrite failed: ${rewritten.stderr || rewritten.stdout}`)
    await git(m, ["reset", "--hard", "main"])
    const refs = await git(m, ["for-each-ref", "--format=%(refname)", "refs/original"])
    for (const ref of refs.stdout.split("\n").filter(Boolean)) await git(m, ["update-ref", "-d", ref])
    await git(m, ["reflog", "expire", "--expire=now", "--all"])
    await git(m, ["gc", "--prune=now"])
    await bun(m, `require("node:fs").rmSync(${JSON.stringify(script)}, { force: true })`)
  },
  check: async (m, seed) => {
    const { old, fresh } = tokens(seed)
    const messages = (await git(m, ["log", "--format=%s", "--reverse", "main"])).stdout.trim().split("\n")
    const status = (await git(m, ["status", "--porcelain"])).stdout.trim()
    const history = await git(m, ["log", "-S", old, "--all", "--oneline"])
    const objects = await run(m, [
      "bash",
      "-c",
      `git cat-file --batch-all-objects --batch | grep -a -c ${JSON.stringify(old)} || true`,
    ])
    const leaked = Number(objects.stdout.trim())
    const app = (await readText(m, "config/app.json")) ?? ""
    const worker = (await readText(m, "config/worker.json")) ?? ""
    const env = (await readText(m, "deploy/env")) ?? ""
    const setup = (await readText(m, "scripts/setup.sh")) ?? ""
    const current = [app, worker, env, setup]
    return verdict([
      check(
        "commit messages kept",
        JSON.stringify(messages) === JSON.stringify(MESSAGES),
        `messages were ${JSON.stringify(messages)}`,
      ),
      check(
        "history rotated",
        history.stdout.trim() === "",
        `git log -S old found ${JSON.stringify(history.stdout.trim())}`,
      ),
      check("objects rotated", leaked === 0, `${leaked} stored objects still contain the old token`),
      check(
        "files rotated",
        current.every((text) => text.includes(fresh) && !text.includes(old)),
        "a config file still has the old token",
      ),
      check("clean tree", status === "", `git status --porcelain was ${JSON.stringify(status)}`),
    ])
  },
}
