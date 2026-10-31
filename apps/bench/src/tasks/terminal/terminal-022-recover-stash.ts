import type { Machine, Task } from "../../types"
import { check, git, int, LIMITS, mulberry32, pick, readJson, verdict, writeJson, writeText } from "../helpers"

const WORDS = ["morning", "launch", "garden", "invoice", "travel", "harbor", "signal", "copper"]
const NAMES = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven"]

const plan = (seed: number): { message: string; initial: string; changed: string } => {
  const rng = mulberry32(seed)
  const message = "Restore " + pick(rng, WORDS) + " notes"
  const initial = "Meeting notes\n\n" + pick(rng, WORDS) + " " + int(rng, 100, 999) + "\n"
  const changed = initial + "\nFollow up with " + pick(rng, NAMES) + " about the " + pick(rng, WORDS) + " plan.\n"
  return { message, initial, changed }
}

const mustGit = async (m: Machine, args: readonly string[]): Promise<void> => {
  const result = await git(m, args, { env: { GIT_EDITOR: "true" } })
  if (result.code !== 0) throw new Error("git " + args.join(" ") + " failed: " + (result.stderr || result.stdout))
}

export const recoverStash: Task = {
  id: "terminal-022-recover-stash",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: true,
  prompt:
    "Some work was stashed earlier. Restore it into the working tree and commit it with the message in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const details = plan(seed)
    await writeJson(m, "request.json", { message: details.message })
    await mustGit(m, ["init", "-b", "main"])
    await mustGit(m, ["config", "user.name", "Bench Owner"])
    await mustGit(m, ["config", "user.email", "owner@example.com"])
    await mustGit(m, ["config", "core.autocrlf", "false"])
    await writeText(m, "notes.txt", details.initial)
    await mustGit(m, ["add", "-A"])
    await mustGit(m, ["commit", "-m", "Initial notes"])
    await writeText(m, "notes.txt", details.changed)
    await mustGit(m, ["stash", "push", "-m", "work in progress"])
  },
  oracle: async (m, seed) => {
    const message = (await readJson<{ message: string }>(m, "request.json"))?.message ?? plan(seed).message
    await mustGit(m, ["stash", "pop"])
    await mustGit(m, ["add", "-A"])
    await mustGit(m, ["commit", "-m", message])
  },
  check: async (m, seed) => {
    const expected = plan(seed)
    const subject = await git(m, ["log", "-1", "--format=%s"])
    const head = await git(m, ["show", "HEAD:notes.txt"])
    const status = await git(m, ["status", "--porcelain"])
    return verdict([
      check(
        "commit message",
        subject.stdout.trim() === expected.message,
        "HEAD subject was " + JSON.stringify(subject.stdout.trim()),
      ),
      check(
        "notes committed",
        head.stdout.trim() === expected.changed.trim(),
        "HEAD:notes.txt was " + JSON.stringify(head.stdout),
      ),
      check("clean tree", status.stdout.trim() === "", "git status was " + JSON.stringify(status.stdout.trim())),
    ])
  },
}
