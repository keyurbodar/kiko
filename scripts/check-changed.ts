import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const CODE = /\.[cm]?[jt]sx?$/
const FORMATTED = /\.([cm]?[jt]sx?|json|jsonc|css|ya?ml|html)$/
const GENERATOR_INPUT = /^apps\/server\/(recipes|skills|src\/agent\/kiko-docs)\/|^apps\/server\/scripts\/gen-/

type Workspace = { name: string; dir: string; deps: string[]; typecheck: boolean }
type Step = { name: string; cmd: string[] }

function git(...args: string[]): string[] {
  const out = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString().trim()}`)
  return out.stdout.toString().split("\n").filter(Boolean)
}

function changedFiles(staged: boolean, ref: string): string[] {
  if (staged) return git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
  const [base] = git("merge-base", "HEAD", ref)
  if (!base) throw new Error(`no merge base with ${ref}. Run git fetch origin, or pass a ref.`)
  return [...new Set([...git("diff", "--name-only", base, "--"), ...git("ls-files", "--others", "--exclude-standard")])]
}

function workspaces(): Workspace[] {
  return ["apps", "packages", "core"].flatMap((group) =>
    readdirSync(join(ROOT, group))
      .map((name) => `${group}/${name}`)
      .filter((dir) => existsSync(join(ROOT, dir, "package.json")))
      .map((dir) => {
        const pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"))
        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((dep) =>
          dep.startsWith("@kiko/"),
        )
        return { name: pkg.name, dir, deps, typecheck: Boolean(pkg.scripts?.typecheck) }
      }),
  )
}

function affected(files: string[], all: Workspace[]): Workspace[] {
  const rootChange = files.some(
    (file) =>
      !all.some((ws) => file.startsWith(`${ws.dir}/`)) && /(^|\/)(package\.json|tsconfig[^/]*\.json)$/.test(file),
  )
  const hit = new Set(
    rootChange
      ? all.map((ws) => ws.name)
      : all.filter((ws) => files.some((file) => file.startsWith(`${ws.dir}/`))).map((ws) => ws.name),
  )
  let grew = true
  while (grew) {
    grew = false
    for (const ws of all) {
      if (!hit.has(ws.name) && ws.deps.some((dep) => hit.has(dep))) {
        hit.add(ws.name)
        grew = true
      }
    }
  }
  return all.filter((ws) => hit.has(ws.name) && ws.typecheck)
}

function plan(files: string[]): Step[] {
  const present = files.filter((file) => existsSync(join(ROOT, file)))
  const code = present.filter((file) => CODE.test(file))
  const formatted = present.filter((file) => FORMATTED.test(file))
  const manifests = files.some((file) => file.endsWith("package.json") || file === "knip.json")
  const packages = affected(files, workspaces())
  const steps: Step[] = []
  if (formatted.length)
    steps.push({ name: "format", cmd: ["bunx", "oxfmt", "--check", "--no-error-on-unmatched-pattern", ...formatted] })
  if (code.length) steps.push({ name: "lint", cmd: ["bunx", "oxlint", "--deny-warnings", ...code] })
  if (code.length)
    steps.push({
      name: "complexity",
      cmd: ["bunx", "biome", "check", "--no-errors-on-unmatched", "--diagnostic-level=error", ...code],
    })
  if (code.length) steps.push({ name: "imports", cmd: ["bun", "scripts/check-imports.ts"] })
  if (code.length || manifests) steps.push({ name: "knip", cmd: ["bun", "run", "knip"] })
  if (files.some((file) => GENERATOR_INPUT.test(file)))
    steps.push({ name: "generated", cmd: ["bun", "scripts/check-generated.ts"] })
  if (packages.length) {
    steps.push({
      name: `typecheck (${packages.length} packages)`,
      cmd: ["bun", "run", ...packages.flatMap((ws) => ["--filter", ws.name]), "typecheck"],
    })
  }
  return steps
}

function run(steps: Step[]): boolean {
  const results = steps.map((step) => {
    console.log(`\n> ${step.name}`)
    const started = performance.now()
    const { exitCode } = Bun.spawnSync(step.cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" })
    return { name: step.name, ok: exitCode === 0, seconds: ((performance.now() - started) / 1000).toFixed(1) }
  })
  console.log("\ncheck:changed summary")
  for (const result of results) console.log(`  ${result.ok ? "pass" : "FAIL"}  ${result.name}  ${result.seconds}s`)
  return results.every((result) => result.ok)
}

const args = process.argv.slice(2)
const staged = args.includes("--staged")
const ref = args.find((arg) => !arg.startsWith("--")) ?? "origin/main"
const files = changedFiles(staged, ref)
if (!files.length) {
  console.log("check:changed: nothing changed")
  process.exit(0)
}
console.log(`check:changed: ${files.length} files${staged ? " staged" : ` since ${ref}`}`)
if (!run(plan(files))) {
  console.log("\nFix the failures above. `bun fmt` fixes formatting.")
  process.exit(1)
}
