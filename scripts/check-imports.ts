import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const ROOT = join(import.meta.dir, "..")
const SPECIFIER = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g

const CORE: Record<string, readonly string[]> = {
  durable: [],
  browser: [],
  agent: ["@kiko/durable"],
  memory: ["@kiko/agent"],
  sandbox: [],
  computer: [],
  protocol: ["@kiko/agent"],
}

const PACKAGES: Record<string, readonly string[]> = {
  theme: ["@kiko/avatar"],
  avatar: [],
  ui: ["@kiko/protocol", "@kiko/theme", "@kiko/avatar"],
}

const APPS = ["web-solid", "landing", "cli", "installer", "computer", "builder"]

const APP_PACKAGES: Record<string, readonly string[]> = { computer: ["@kiko/computer"] }

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

const problems: string[] = []

function check(home: string, allowed: readonly string[], strict: boolean) {
  const label = relative(ROOT, home)
  for (const file of files(join(home, "src"))) inspect(file, label, allowed, strict)
}

function inspect(file: string, label: string, allowed: readonly string[], strict: boolean) {
  const at = relative(ROOT, file)
  for (const [, spec = ""] of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
    const problem = judge(at, file, label, allowed, strict, spec)
    if (problem) problems.push(problem)
  }
}

function judge(
  at: string,
  file: string,
  label: string,
  allowed: readonly string[],
  strict: boolean,
  spec: string,
): string | null {
  if (spec.startsWith(".")) return judgeRelative(at, file, label, strict, spec)
  if (!spec.startsWith("@kiko/") || !strict) return null
  const dep = spec.split("/").slice(0, 2).join("/")
  if (dep === `@kiko/${label.split("/")[1]}`) return null
  return allowed.includes(dep) ? null : `${at}: ${dep} is not allowed in ${label}`
}

function judgeRelative(at: string, file: string, label: string, strict: boolean, spec: string): string | null {
  const rel = relative(ROOT, resolve(dirname(file), spec))
  if (strict) return rel.startsWith(label) ? null : `${at}: ${spec} leaves ${label}`
  if (rel.startsWith("apps/server/") && !at.startsWith("apps/server")) return `${at}: ${spec} reaches into the server`
  if (/^(core|packages)\//.test(rel)) return `${at}: ${spec} reaches into ${rel.split("/").slice(0, 2).join("/")}`
  return null
}

for (const [pkg, allowed] of Object.entries(CORE)) check(join(ROOT, "core", pkg), allowed, true)
for (const [pkg, allowed] of Object.entries(PACKAGES)) check(join(ROOT, "packages", pkg), allowed, true)
for (const app of APPS) {
  const allowed = APP_PACKAGES[app]
  check(join(ROOT, "apps", app), allowed ?? [], allowed !== undefined)
}

if (problems.length) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log("imports ok")
