import { spawnSync } from "node:child_process"

const FORMATTED = /\.([cm]?[jt]sx?|json|jsonc|css|ya?ml|html)$/

const git = (...args: string[]): string[] =>
  spawnSync("git", ["-c", "core.quotePath=false", ...args], { encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean)

const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR").filter((file) => FORMATTED.test(file))
const partial = new Set(git("diff", "--name-only"))
const whole = staged.filter((file) => !partial.has(file))
const split = staged.filter((file) => partial.has(file))

const oxfmt = (...args: string[]) =>
  spawnSync("bunx", ["oxfmt", "--no-error-on-unmatched-pattern", ...args], { stdio: "inherit" }).status === 0

let ok = true
if (whole.length > 0) {
  ok = oxfmt(...whole) && spawnSync("git", ["add", "--", ...whole], { stdio: "inherit" }).status === 0
}
if (split.length > 0 && !oxfmt("--check", ...split)) {
  console.error("Partly staged files need formatting. Run `bun fmt`, stage the result, and commit again.")
  ok = false
}
process.exitCode = ok ? 0 : 1
