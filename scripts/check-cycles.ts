import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, resolve, relative } from "node:path"
const ROOTS = [
  "apps/web-solid/src",
  "packages/ui/src",
  "packages/theme/src",
  "core/protocol/src",
  "packages/avatar/src",
]
const files = []
const walk = (d) => {
  try {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(n)) files.push(p)
    }
  } catch {}
}
ROOTS.forEach(walk)
const resolveSpec = (from, spec) => {
  if (!spec.startsWith(".")) return null
  const base = resolve(dirname(from), spec)
  for (const cand of [base, base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"]) {
    try {
      if (statSync(cand).isFile()) return relative(process.cwd(), cand)
    } catch {}
  }
  return null
}
const graph = new Map()
for (const f of files) {
  const src = readFileSync(f, "utf8")
  const deps = new Set()
  for (const line of src.split("\n")) {
    const t = line.trim()
    if (!t.startsWith("import") && !t.startsWith("export")) continue
    if (/^import\s+type\b/.test(t) || /^export\s+type\b/.test(t)) continue
    const m = /from\s*["']([^"']+)["']/.exec(t)
    if (!m) continue
    const r = resolveSpec(f, m[1])
    if (r) deps.add(r)
  }
  graph.set(relative(process.cwd(), f), [...deps])
}
const state = new Map(),
  stack = [],
  cycles = []
const dfs = (n) => {
  if (state.get(n) === "done") return
  if (state.get(n) === "open") {
    const i = stack.indexOf(n)
    cycles.push([...stack.slice(i), n])
    return
  }
  state.set(n, "open")
  stack.push(n)
  for (const d of graph.get(n) ?? []) dfs(d)
  stack.pop()
  state.set(n, "done")
}
for (const n of graph.keys()) dfs(n)
const seen = new Set()
const uniq = cycles.filter((c) => {
  const k = [...c].sort().join("|")
  if (seen.has(k)) return false
  seen.add(k)
  return true
})
console.log(`runtime cycles: ${uniq.length} across ${graph.size} modules`)
for (const c of uniq) {
  console.log("\nCYCLE:")
  for (const x of c) console.log("  " + x.replace(/^.*?(apps|packages|core)\//, "$1/"))
}
if (uniq.length) process.exit(1)
