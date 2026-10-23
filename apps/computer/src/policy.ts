import { resolve, sep } from "node:path"
import type { Policy } from "./config"
import { homeDir } from "./platform"

function expandHome(path: string): string {
  const home = homeDir()
  if (path === "~") return home
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(home, path.slice(2))
  return path
}

const fold = (path: string): string => (process.platform === "win32" ? path.toLowerCase() : path)

export function allowedPath(policy: Policy, path: string): string | null {
  const wanted = resolve(expandHome(path))
  const key = fold(wanted)
  for (const root of policy.files.allow) {
    const base = fold(resolve(expandHome(root)))
    if (key === base || key.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)) return wanted
  }
  return null
}
