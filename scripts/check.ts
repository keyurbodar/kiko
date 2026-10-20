// One command that says whether the tree is good. Runs every step as a parallel process, prints one
// line per step with pass or fail and time, then the output of each failing step.
import { join } from "node:path"

const root = join(import.meta.dir, "..")
// `advisory` steps print their result but never fail the run.
type Step = { name: string; cmd: string[]; cwd: string; advisory?: boolean }

const steps: Step[] = [
  { name: "typecheck", cmd: ["bun", "run", "typecheck"], cwd: root },
  { name: "lint", cmd: ["bunx", "biome", "check", "apps/server", "core", "apps/cli", "scripts"], cwd: root },
  { name: "lint (frontend, not gating)", cmd: ["bunx", "biome", "check", "packages", "apps/web-solid"], cwd: root, advisory: true },
]
for (const script of ["check-imports", "check-rules", "check-exports"]) {
  steps.push({ name: script, cmd: ["bun", `scripts/${script}.ts`], cwd: root })
}

type Result = { step: Step; code: number; output: string }

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
      return { step, code, output }
    }),
  )

const results = await run(steps)


const gating = results.filter((r) => !r.step.advisory)
const bad = gating.filter((r) => r.code !== 0)
for (const r of bad) console.log(`\n--- ${r.step.name} ---\n${r.output.trim()}`)
console.log(bad.length ? `\n${bad.length} of ${gating.length} steps failed` : `\nall ${gating.length} steps passed`)
process.exit(bad.length ? 1 : 0)
