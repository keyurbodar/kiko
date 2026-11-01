import { realpathSync } from "node:fs"
import { basename, dirname, resolve, sep } from "node:path"
import type { Policy } from "./config"
import { homeDir } from "./platform"

function expandHome(path: string): string {
  const home = homeDir()
  if (path === "~") return home
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(home, path.slice(2))
  return path
}

function canonical(path: string): string {
  const rest: string[] = []
  let current = resolve(path)
  for (;;) {
    try {
      return resolve(realpathSync(current), ...rest.toReversed())
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(current, ...rest.toReversed())
      rest.push(basename(current))
      current = parent
    }
  }
}

export function allowedPath(policy: Policy, path: string): string | null {
  const wanted = canonical(expandHome(path))
  for (const root of policy.files.allow) {
    const base = canonical(expandHome(root))
    if (wanted === base || wanted.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) return wanted
  }
  return null
}
