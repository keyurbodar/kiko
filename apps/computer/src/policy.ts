import { readlinkSync, realpathSync } from "node:fs"
import { basename, dirname, resolve, sep } from "node:path"
import type { Policy } from "./config"
import { homeDir } from "./platform"

const LINK_LIMIT = 40

function expandHome(path: string): string {
  const home = homeDir()
  if (path === "~") return home
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(home, path.slice(2))
  return path
}

const fold = (path: string): string => (process.platform === "win32" ? path.toLowerCase() : path)

function readLink(path: string): string | null {
  try {
    return readlinkSync(path)
  } catch {
    return null
  }
}

function canonical(path: string, hops: number): string | null {
  const resolved = resolve(path)
  try {
    return realpathSync.native(resolved)
  } catch {}
  const parent = dirname(resolved)
  if (parent === resolved) return null
  const base = canonical(parent, hops)
  if (base === null || hops >= LINK_LIMIT) return null
  const link = readLink(resolved)
  return link === null ? resolve(base, basename(resolved)) : canonical(resolve(base, link), hops + 1)
}

export function allowedPath(policy: Policy, path: string): string | null {
  const wanted = canonical(expandHome(path), 0)
  if (wanted === null) return null
  const key = fold(wanted)
  for (const root of policy.files.allow) {
    const base = canonical(expandHome(root), 0)
    if (base === null) continue
    const rootKey = fold(base)
    if (key === rootKey || key.startsWith(rootKey.endsWith(sep) ? rootKey : `${rootKey}${sep}`)) return wanted
  }
  return null
}
