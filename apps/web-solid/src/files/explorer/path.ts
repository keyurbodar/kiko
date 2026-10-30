import { fileName } from "@kiko/protocol"
import { dirname, folderLabel, join, ROOT } from "../model"

export type Breadcrumb = {
  path: string
  label: string
  kind: "root" | "directory" | "file"
}

const segments = (path: string) => path.split("/").filter(Boolean)

export const breadcrumbPathOf = (path: string) => path.replace(/\/+$/, "")

const prefixes = (path: string): string[] => {
  const out: string[] = [ROOT]
  let at = ROOT
  for (const part of segments(breadcrumbPathOf(path))) {
    at = join(at, part)
    out.push(at)
  }
  return out
}

export function fileCrumbs(trail: string, folders: ReadonlySet<string>): Breadcrumb[] {
  const parts = segments(breadcrumbPathOf(trail))
  const out: Breadcrumb[] = [{ path: ROOT, label: folderLabel(ROOT), kind: "root" }]
  let at = ROOT
  parts.forEach((part, index) => {
    at = join(at, part)
    const directory = index < parts.length - 1 || folders.has(at)
    out.push({ path: at, label: directory ? folderLabel(at) : fileName(at), kind: directory ? "directory" : "file" })
  })
  return out
}

function crumbIndex(trail: string, path: string): number {
  return prefixes(trail).indexOf(breadcrumbPathOf(path))
}

export function retainedBreadcrumbTrail(trail: string | undefined, path: string): string {
  return trail !== undefined && crumbIndex(trail, path) >= 0 ? trail : breadcrumbPathOf(path)
}

export function trailChildOf(folder: string, trail: string): string | null {
  const paths = prefixes(trail)
  const at = paths.indexOf(breadcrumbPathOf(folder))
  return at < 0 || at === paths.length - 1 ? null : (segments(paths[at + 1]!).at(-1) ?? null)
}

export function isCrumbBelow(current: string, crumb: string): boolean {
  const index = crumbIndex(current, crumb)
  return index >= 0 && index < prefixes(current).length - 1
}

export function navigableBack(crumb: string, at: string): string | null {
  const folder = breadcrumbPathOf(crumb)
  const here = breadcrumbPathOf(at)
  if (here === folder) return null
  const parent = dirname(here)
  return folder === ROOT || parent === folder || parent.startsWith(`${folder}/`) ? parent : null
}

export function folderChildren(
  index: { children: Map<string, string[]>; folders: Set<string> },
  dir: string,
): { path: string; label: string; directory: boolean }[] | null {
  const children = index.children.get(breadcrumbPathOf(dir))
  if (!children) return null
  return children.map((path) => ({
    path,
    label: index.folders.has(path) ? folderLabel(path) : fileName(path),
    directory: index.folders.has(path),
  }))
}
