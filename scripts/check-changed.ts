import { execFileSync, spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { decide, readWorkspace } from "./ci-changes"

const ROOT = join(import.meta.dirname, "..")
const CODE = /\.[cm]?[jt]sx?$/
const FORMATTED = /\.([cm]?[jt]sx?|json|jsonc|css|ya?ml|html)$/
const TEST = /\.test\.[cm]?[jt]sx?$/
const GENERATOR_INPUT = /^apps\/server\/(recipes|skills|src\/agent\/kiko-docs)\/|^apps\/server\/scripts\/gen-/
const CACHE = join(ROOT, "node_modules/.cache/check-changed.json")

type Step = { name: string; cmd: string[] }
type Result = { name: string; ok: boolean; seconds: string }

const git = (...args: string[]): string[] =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\n")
    .filter(Boolean)

const ref = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "origin/main"
const mergeBase = spawnSync("git", ["merge-base", "HEAD", ref], { cwd: ROOT, encoding: "utf8" })
if (mergeBase.status !== 0) {
  console.error(`check:changed: no merge base with ${ref}. Run \`git fetch origin\` or pass a ref.`)
  process.exit(1)
}
const base = mergeBase.stdout.trim()
const changed = () => [
  ...new Set([
    ...git("diff", "--name-only", "--no-renames", base, "--"),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]),
]
const files = changed().sort()

if (files.length === 0) {
  console.log(`check:changed: no changes since ${base.slice(0, 12)}.`)
  process.exit(0)
}
console.log(`check:changed: ${files.length} files since ${base.slice(0, 12)}`)

function inputKey(): string {
  const hash = createHash("sha256")
  hash.update(`${process.versions.bun ?? process.version}\0${process.version}\0${base}\0${process.env.CI ?? ""}\0`)
  hash.update(
    execFileSync("git", ["diff", "--binary", "--no-renames", "--no-ext-diff", "--no-textconv", base, "--"], {
      cwd: ROOT,
      maxBuffer: 1 << 30,
    }),
  )
  const ignored = git(
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--",
    ":(glob)**/*.d.ts",
    ":(glob)**/.env*",
    ":(glob)**/.dev.vars",
    ":(exclude,glob)**/node_modules/**",
  )
  for (const file of [...changed(), ...ignored]) {
    hash.update(`\0${file}\0`)
    const path = join(ROOT, file)
    if (statSync(path, { throwIfNoEntry: false })?.isFile()) hash.update(readFileSync(path))
  }
  const installed = join(ROOT, "node_modules/.bun")
  if (existsSync(installed)) hash.update(readdirSync(installed).sort().join("\0"))
  return hash.digest("hex")
}

const key = inputKey()
const readCache = (): { key: string; summary: string[] } | undefined => {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"))
  } catch {
    return undefined
  }
}
const cached = readCache()
if (cached?.key === key) {
  console.log("Nothing changed since the last passing run.\n")
  for (const line of cached.summary) console.log(line)
  process.exit(0)
}

const present = files.filter((file) => existsSync(join(ROOT, file)))
const code = present.filter((file) => CODE.test(file))
const formatted = present.filter((file) => FORMATTED.test(file))
const { affected, outputs } = decide(files, readWorkspace(), false)
const packages = readWorkspace().filter((pkg) => pkg.hasTypecheck && affected.includes(pkg.name))

const tests = new Set(code.filter((file) => TEST.test(file)))
for (const file of code) {
  const dir = dirname(file)
  const prefix = `${basename(file).replace(CODE, "")}.`
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry.startsWith(prefix) && TEST.test(entry)) tests.add(join(dir, entry))
  }
}

const runKnip = files.some((file) => CODE.test(file) || basename(file) === "package.json" || file === "knip.json")

const steps: Step[] = [
  formatted.length > 0 && {
    name: "format",
    cmd: ["bunx", "oxfmt", "--check", "--no-error-on-unmatched-pattern", ...formatted],
  },
  code.length > 0 && { name: "lint", cmd: ["bunx", "oxlint", "--deny-warnings", ...code] },
  code.length > 0 && {
    name: "complexity",
    cmd: ["bunx", "biome", "check", "--no-errors-on-unmatched", "--diagnostic-level=error", ...code],
  },
  code.length > 0 && { name: "imports", cmd: ["bun", "scripts/check-imports.ts"] },
  runKnip && { name: "knip", cmd: ["bun", "run", "knip"] },
  files.some((file) => GENERATOR_INPUT.test(file)) && {
    name: "generated",
    cmd: ["bun", "scripts/check-generated.ts"],
  },
  packages.length > 0 && {
    name: `typecheck (${packages.length} packages)`,
    cmd: [
      "bun",
      "run",
      "--parallel",
      "--no-exit-on-error",
      ...packages.flatMap((pkg) => ["--filter", pkg.name]),
      "typecheck",
    ],
  },
  tests.size > 0 && {
    name: `test (${tests.size} files)`,
    cmd: ["bunx", "vitest", "run", "--passWithNoTests", ...tests],
  },
].filter((step): step is Step => step !== false)

const env = process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env

function run(step: Step): Promise<Result> {
  return new Promise((resolve) => {
    const started = performance.now()
    const output: Buffer[] = []
    const child = spawn(step.cmd[0] ?? "", step.cmd.slice(1), { cwd: ROOT, env })
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk))
    child.on("error", (error) => output.push(Buffer.from(`${error.message}\n`)))
    child.on("close", (status) => {
      const ok = status === 0
      const seconds = ((performance.now() - started) / 1000).toFixed(1)
      console.log(`\n> ${step.name}  ${ok ? "pass" : "FAIL"}  ${seconds}s`)
      process.stdout.write(Buffer.concat(output))
      resolve({ name: step.name, ok, seconds })
    })
  })
}

const results = await Promise.all(steps.map(run))

const summary = ["check:changed summary"]
for (const result of results) summary.push(`  ${result.ok ? "pass" : "FAIL"}  ${result.name}  ${result.seconds}s`)
const ciOnly = Object.entries({
  "full test suites": outputs.test || outputs.test_web,
  "worker integration": outputs.worker,
  "build and worker bundles": outputs.build,
}).flatMap(([job, runs]) => (runs ? [job] : []))
if (ciOnly.length > 0) summary.push(`  CI also runs: ${ciOnly.join(", ")}`)
if (!runKnip) summary.push("  knip skipped: no code or manifest changed")
console.log(`\n${summary.join("\n")}`)

if (results.some((result) => !result.ok)) {
  console.log(
    "\nFix the failures above. `bun fmt` fixes formatting. A missing module after a pull needs `bun install`.",
  )
  process.exitCode = 1
} else if (inputKey() !== key) {
  console.log("  pass not cached: files changed during the run")
} else {
  try {
    const temp = `${CACHE}.${process.pid}`
    mkdirSync(dirname(CACHE), { recursive: true })
    writeFileSync(temp, JSON.stringify({ key, summary }))
    renameSync(temp, CACHE)
  } catch (error) {
    console.warn(`  pass not cached: ${error instanceof Error ? error.message : String(error)}`)
  }
}
