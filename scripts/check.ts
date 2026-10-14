// One command that says whether the tree is good. Runs every step as a parallel process, prints one
// line per step with pass or fail and time, then the output of each failing step. Server test files
// are cached by apps/server/scripts/test-each.ts, so a second run on an unchanged tree is fast.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { flakyLines } from "./flaky.ts"

const root = join(import.meta.dir, "..")
// `last` steps run after the rest, alone: their tests assert wall-clock budgets that fail when typecheck holds the CPUs.
// `test` steps that fail get one rerun alone after the wave. They pass if the rerun passes, and the line says so,
// with the first run's failing files and their first assertion under it (the rerun only reruns the failed files).
// `advisory` steps print their result but never fail the run.
type Step = { name: string; cmd: string[]; cwd: string; last?: boolean; test?: boolean; advisory?: boolean }

const steps: Step[] = [
  { name: "typecheck", cmd: ["bun", "run", "typecheck"], cwd: root },
  { name: "lint", cmd: ["bunx", "biome", "check", "apps/server", "core", "apps/cli", "scripts"], cwd: root },
  { name: "lint (frontend, not gating)", cmd: ["bunx", "biome", "check", "packages", "apps/web-solid"], cwd: root, advisory: true },
]
for (const script of ["check-imports", "check-rules", "check-exports"]) {
  steps.push({ name: script, cmd: ["bun", `scripts/${script}.ts`], cwd: root })
}
steps.push({ name: "test scripts", cmd: ["bun", "test", join(root, "scripts") + "/"], cwd: root })
for (const group of ["apps", "core", "packages"]) {
  for (const name of readdirSync(join(root, group))) {
    const dir = join(root, group, name)
    const pkg = join(dir, "package.json")
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).scripts?.test)
      steps.push({ name: `test ${group}/${name}`, cmd: ["bun", "run", "test"], cwd: dir, last: name === "web-solid", test: true })
  }
}

type Result = { step: Step; code: number; output: string; flaky: boolean }

// Biome prints "Found N errors." only when there are some; its exit code alone cannot say how many.
const errorCount = (output: string) => Number(/Found (\d+) errors?\./.exec(output)?.[1] ?? 0)

const exec = async (step: Step): Promise<{ code: number; output: string; seconds: string }> => {
  const start = performance.now()
  const proc = Bun.spawn(step.cmd, { cwd: step.cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, output: stdout + stderr, seconds: ((performance.now() - start) / 1000).toFixed(1) }
}

const run = (list: Step[]) =>
  Promise.all(
    list.map(async (step): Promise<Result> => {
      const { code, output, seconds } = await exec(step)
      const detail = step.advisory ? `${errorCount(output)} errors` : ""
      console.log(`${code === 0 ? "pass" : "FAIL"}  ${step.name.padEnd(28)} ${seconds}s  ${detail}`.trimEnd())
      return { step, code, output, flaky: false }
    }),
  )

const results = [...(await run(steps.filter((s) => !s.last))), ...(await run(steps.filter((s) => s.last)))]

// A failed test step gets one rerun with the machine to itself. Only a second failure counts.
for (const r of results) {
  if (r.code === 0 || !r.step.test) continue
  const again = await exec(r.step)
  if (again.code === 0) {
    r.code = 0
    r.flaky = true
    console.log(`pass  ${r.step.name.padEnd(28)} ${again.seconds}s  flaky, passed on rerun`)
    for (const line of flakyLines(r.output)) console.log(line)
  } else {
    r.output = again.output
    console.log(`FAIL  ${r.step.name.padEnd(28)} ${again.seconds}s  failed on rerun too`)
  }
}

const gating = results.filter((r) => !r.step.advisory)
const bad = gating.filter((r) => r.code !== 0)
for (const r of bad) console.log(`\n--- ${r.step.name} ---\n${r.output.trim()}`)
const flaky = gating.filter((r) => r.flaky).length
console.log(bad.length ? `\n${bad.length} of ${gating.length} steps failed` : `\nall ${gating.length} steps passed${flaky ? ` (${flaky} flaky)` : ""}`)
process.exit(bad.length ? 1 : 0)
