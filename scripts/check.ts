// One command that says whether the tree is good. Runs every step as a parallel process, prints one
// line per step with pass or fail and time, then the output of each failing step. Server test files
// are cached by apps/server/scripts/test-each.ts, so a second run on an unchanged tree is fast.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
// `last` steps run after the rest, alone: their tests assert wall-clock budgets that fail when typecheck holds the CPUs.
type Step = { name: string; cmd: string[]; cwd: string; last?: boolean }

const steps: Step[] = [
  { name: "typecheck", cmd: ["bun", "run", "typecheck"], cwd: root },
  { name: "lint", cmd: ["bun", "run", "lint"], cwd: root },
]
for (const script of ["check-imports", "check-rules", "check-exports"]) {
  if (existsSync(join(root, "scripts", `${script}.ts`))) steps.push({ name: script, cmd: ["bun", `scripts/${script}.ts`], cwd: root })
}
for (const group of ["apps", "core", "packages"]) {
  for (const name of readdirSync(join(root, group))) {
    const dir = join(root, group, name)
    const pkg = join(dir, "package.json")
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).scripts?.test) steps.push({ name: `test ${group}/${name}`, cmd: ["bun", "run", "test"], cwd: dir, last: name === "web-solid" })
  }
}

const run = (list: Step[]) =>
  Promise.all(
    list.map(async (step) => {
      const start = performance.now()
      const proc = Bun.spawn(step.cmd, { cwd: step.cwd, stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      const seconds = (performance.now() - start) / 1000
      console.log(`${code === 0 ? "pass" : "FAIL"}  ${step.name.padEnd(24)} ${seconds.toFixed(1)}s`)
      return { step, code, output: stdout + stderr }
    }),
  )

const results = [...(await run(steps.filter((s) => !s.last))), ...(await run(steps.filter((s) => s.last)))]

const bad = results.filter((r) => r.code !== 0)
for (const r of bad) console.log(`\n--- ${r.step.name} ---\n${r.output.trim()}`)
console.log(bad.length ? `\n${bad.length} of ${results.length} steps failed` : `\nall ${results.length} steps passed`)
process.exit(bad.length ? 1 : 0)
