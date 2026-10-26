import type { Surface } from "./panels"

export type FileSurface = Extract<Surface, { kind: "file" }>

export type DeskNav = { view: Surface | null; files: readonly FileSurface[] }

export const EMPTY_NAV: DeskNav = { view: null, files: [] }

const FILES: Surface = { id: "files", kind: "files" }

export const fileSurface = (path: string): FileSurface => ({ id: `file:${path}`, kind: "file", path })

export function openView(nav: DeskNav, surface: Surface): DeskNav {
  if (surface.kind !== "file") return nav.view?.id === surface.id ? nav : { ...nav, view: surface }
  const has = nav.files.some((f) => f.id === surface.id)
  if (has && nav.view?.id === surface.id) return nav
  return { view: surface, files: has ? nav.files : [...nav.files, surface] }
}

export function back(nav: DeskNav): DeskNav {
  if (!nav.view) return nav
  return { ...nav, view: nav.view.kind === "file" ? FILES : null }
}

export function closeFile(nav: DeskNav, id: string): DeskNav {
  const at = nav.files.findIndex((f) => f.id === id)
  if (at < 0) return nav
  const files = nav.files.filter((_, i) => i !== at)
  if (nav.view?.id !== id) return { ...nav, files }
  return { files, view: files[at] ?? files[at - 1] ?? FILES }
}

export function keepOnly(nav: DeskNav, id: string): DeskNav {
  const keep = nav.files.find((f) => f.id === id)
  return keep ? { files: [keep], view: keep } : nav
}

export function closeRightOf(nav: DeskNav, id: string): DeskNav {
  const at = nav.files.findIndex((f) => f.id === id)
  if (at < 0 || at === nav.files.length - 1) return nav
  const files = nav.files.slice(0, at + 1)
  const viewGone = nav.view?.kind === "file" && !files.some((f) => f.id === nav.view?.id)
  return { files, view: viewGone ? files[at]! : nav.view }
}

export function closeFiles(nav: DeskNav): DeskNav {
  if (nav.files.length === 0) return nav
  return { files: [], view: nav.view?.kind === "file" ? FILES : nav.view }
}

export function moveFiles(nav: DeskNav, from: string, to: string): DeskNav {
  const under = (p: string) => p === from || p.startsWith(`${from}/`)
  const moved = (f: FileSurface) => (under(f.path) ? fileSurface(to + f.path.slice(from.length)) : f)
  if (!nav.files.some((f) => under(f.path))) return nav
  const files: FileSurface[] = []
  for (const f of nav.files.map(moved)) if (!files.some((g) => g.id === f.id)) files.push(f)
  const view = nav.view?.kind === "file" ? moved(nav.view) : nav.view
  return { files, view }
}

export function dropFiles(nav: DeskNav, path: string): DeskNav {
  const gone = (f: FileSurface) => f.path === path || f.path.startsWith(`${path}/`)
  if (!nav.files.some(gone)) return nav
  const files = nav.files.filter((f) => !gone(f))
  return { files, view: nav.view?.kind === "file" && gone(nav.view) ? FILES : nav.view }
}
