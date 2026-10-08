/*
 * The package layering. Each reusable package may import only the @kiko packages listed for it, and
 * never the apps or a file outside its own directory. Fails with every offending import.
 *
 *   bun scripts/check-imports.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const ALLOWED: Record<string, readonly string[]> = {
  durable: [],
  agent: ["@kiko/durable"],
  memory: ["@kiko/agent"],
  sandbox: ["@kiko/agent"],
  protocol: ["@kiko/agent", "@kiko/sandbox"],
}

const ROOT = join(import.meta.dir, "..")
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

const problems: string[] = []
for (const [pkg, allowed] of Object.entries(ALLOWED)) {
  const home = join(ROOT, "packages", pkg)
  for (const file of files(join(home, "src"))) {
    for (const [, spec = ""] of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const at = relative(ROOT, file)
      if (spec.startsWith(".")) {
        if (relative(home, resolve(dirname(file), spec)).startsWith("..")) problems.push(`${at}: ${spec} leaves packages/${pkg}`)
      } else if (spec.startsWith("@kiko/")) {
        const name = spec.split("/").slice(0, 2).join("/")
        if (name !== `@kiko/${pkg}` && !allowed.includes(name)) problems.push(`${at}: ${name} is not allowed in @kiko/${pkg}`)
      }
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log(`imports ok: ${Object.keys(ALLOWED).join(", ")}`)
