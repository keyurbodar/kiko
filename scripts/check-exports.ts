import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// Every export under apps/server/src and core/*/src must be used by another file under apps/ or core/.
// A name counts as used when it appears as a word in any other file. Barrel re-exports count as use.

const ROOT = join(import.meta.dir, "..")
const EXPORT = /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|abstract\s+class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm

function files(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    if (name === "node_modules" || name === ".wrangler" || name === "dist") return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

const start = performance.now()
const all = [...files(join(ROOT, "apps")), ...files(join(ROOT, "core"))]
const text = new Map(all.map((f) => [f, readFileSync(f, "utf8")]))
const coreDirs = readdirSync(join(ROOT, "core")).map((d) => join(ROOT, "core", d, "src"))
const owned = [...files(join(ROOT, "apps/server/src")), ...coreDirs.flatMap(files)].filter((f) => !f.endsWith(".gen.ts"))

// Index word -> files that contain it, so each export is a lookup.
const WORD = /[A-Za-z_$][\w$]*/g
const where = new Map<string, Set<string>>()
for (const [file, body] of text) for (const w of new Set(body.match(WORD))) (where.get(w) ?? where.set(w, new Set()).get(w)!).add(file)

// Exports that were unused when this check landed. New ones fail; delete a line when its export goes.
const baselinePath = join(import.meta.dir, "exports-baseline.txt")
const baseline = new Set(readFileSync(baselinePath, "utf8").split("\n").filter(Boolean))
const unused: string[] = []
for (const file of owned) {
  const body = text.get(file) ?? ""
  for (const m of body.matchAll(EXPORT)) {
    const name = m[1] ?? ""
    const line = body.slice(0, m.index).split("\n").length
    const prev = body.slice(0, m.index).split("\n").at(-2) ?? ""
    if (/\/\/\s*check-exports:\s*allow\s+\S/.test(prev)) continue
    if (![...(where.get(name) ?? [])].some((f) => f !== file)) unused.push(`${relative(ROOT, file)}:${name}:${line}`)
  }
}

const key = (u: string) => u.slice(0, u.lastIndexOf(":"))
if (process.argv.includes("--write-baseline")) {
  await Bun.write(baselinePath, `${unused.map(key).sort().join("\n")}\n`)
  console.log(`wrote ${unused.length} entries`)
  process.exit(0)
}
const problems = unused.filter((u) => !baseline.has(key(u))).map((u) => `${key(u).replace(/:(\w+)$/, `:${u.split(":").at(-1)} unused-export $1`)}`)
const fixed = [...baseline].filter((b) => !unused.some((u) => key(u) === b)).length
const ms = Math.round(performance.now() - start)
if (problems.length) {
  console.error(problems.join("\n"))
  console.error(`check-exports FAILED: ${problems.length} new unused in ${ms} ms`)
  process.exit(1)
}
console.log(`check-exports ok: ${owned.length} files, ${baseline.size} baselined${fixed ? `, ${fixed} baseline entries now used or gone (delete them)` : ""} in ${ms} ms`)
