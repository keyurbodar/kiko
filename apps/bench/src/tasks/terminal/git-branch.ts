import { join } from "node:path"

import type { Check, Machine, Task, Verdict } from "../../types"

const git = (m: Machine, args: readonly string[]) => m.exec(["git", "-C", m.workdir, ...args])

async function setupBranch(m: Machine): Promise<void> {
  await m.exec(["git", "init", "-b", "main"], { cwd: m.workdir })
  await git(m, ["config", "user.email", "bench@kiko.local"])
  await git(m, ["config", "user.name", "kiko bench"])
  await m.writeText(join(m.workdir, "base.txt"), "base\n")
  await git(m, ["add", "-A"])
  await git(m, ["commit", "-m", "base"])
}

async function oracleBranch(m: Machine): Promise<void> {
  await git(m, ["checkout", "-b", "feature"])
  await m.writeText(join(m.workdir, "notes.txt"), "hello\n")
  await git(m, ["add", "notes.txt"])
  await git(m, ["commit", "-m", "notes"])
}

async function checkFeatureExists(m: Machine): Promise<Check> {
  const result = await git(m, ["rev-parse", "--verify", "feature"])
  const pass = result.code === 0
  return { name: "feature exists", pass, detail: `git rev-parse --verify feature exited ${result.code}` }
}

async function checkNotesCommit(m: Machine): Promise<Check> {
  const count = await git(m, ["rev-list", "--count", "main..feature"])
  const content = await git(m, ["show", "feature:notes.txt"])
  const commits = count.stdout.trim()
  const notes = content.stdout.trim()
  const pass = count.code === 0 && commits === "1" && content.code === 0 && notes === "hello"
  return {
    name: "one commit adds notes.txt",
    pass,
    detail: `main..feature has ${JSON.stringify(commits)} commits, notes.txt is ${JSON.stringify(notes)}`,
  }
}

async function checkBranch(m: Machine): Promise<Verdict> {
  const checks = [await checkFeatureExists(m), await checkNotesCommit(m)]
  return { pass: checks.every((check) => check.pass), checks }
}

export const gitBranch: Task = {
  id: "terminal-027-git-branch",
  track: "terminal",
  os: ["macos", "windows", "linux"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "create a git branch called feature with exactly one commit that adds a file notes.txt containing the line hello",
  limits: { turns: 12, seconds: 180 },
  setup: setupBranch,
  oracle: oracleBranch,
  check: checkBranch,
}
