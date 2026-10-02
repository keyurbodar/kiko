// Runs every server test file in its own `bun test` process. Each file boots its own workerd through
// Miniflare; nineteen of them in one process collided on ports and timed out at random, so a green run
// meant little. One process per file is slower and deterministic. Exit code 1 if any file fails.
import { readdirSync } from "node:fs"
import { join } from "node:path"

const dir = join(import.meta.dir, "..", "test")
const only = process.argv.slice(2)
const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts") && (!only.length || only.some((o) => f.includes(o)))).sort()
let failed = 0
let passed = 0
for (const f of files) {
  const run = Bun.spawnSync(["bun", "test", join("test", f)], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" })
  const out = run.stdout.toString() + run.stderr.toString()
  const pass = Number(/(\d+) pass/.exec(out)?.[1] ?? 0)
  const fail = Number(/(\d+) fail/.exec(out)?.[1] ?? 0)
  passed += pass
  failed += fail + (run.exitCode !== 0 && fail === 0 ? 1 : 0)
  console.log(`${run.exitCode === 0 ? "ok  " : "FAIL"} ${f}  ${pass} pass${fail ? `, ${fail} fail` : ""}`)
  if (run.exitCode !== 0) console.log(out.split("\n").filter((l) => /\(fail\)|error:/.test(l)).slice(0, 6).join("\n"))
}
console.log(`\n${passed} pass, ${failed} fail across ${files.length} files`)
process.exit(failed ? 1 : 0)
