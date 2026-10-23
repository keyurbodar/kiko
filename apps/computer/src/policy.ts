import { resolve, sep } from "node:path"
import type { Policy } from "./config"
import { homeDir } from "./platform"

function expandHome(path: string): string {
  const home = homeDir()
  if (path === "~") return home
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(home, path.slice(2))
  return path
}

export function allowedPath(policy: Policy, path: string): string | null {
  const wanted = resolve(expandHome(path))
  for (const root of policy.files.allow) {
    const base = resolve(expandHome(root))
    if (wanted === base || wanted.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) return wanted
  }
  return null
}
