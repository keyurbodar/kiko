import type { Surface } from "./panels"

export type FileSurface = Extract<Surface, { kind: "file" }>

export type DeskNav = { surfaces: readonly Surface[]; active: string | null }

export const EMPTY_NAV: DeskNav = { surfaces: [], active: null }

export const fileSurface = (path: string): FileSurface => ({ id: `file:${path}`, kind: "file", path })

export function openSurface(nav: DeskNav, surface: Surface): DeskNav {
  if (nav.surfaces.some((open) => open.id === surface.id)) {
    return nav.active === surface.id ? nav : { ...nav, active: surface.id }
  }
  return { surfaces: [...nav.surfaces, surface], active: surface.id }
}

export function activateSurface(nav: DeskNav, id: string): DeskNav {
  return nav.surfaces.some((surface) => surface.id === id) && nav.active !== id ? { ...nav, active: id } : nav
}

export function deactivate(nav: DeskNav): DeskNav {
  return nav.active === null ? nav : { ...nav, active: null }
}

export function closeSurface(nav: DeskNav, id: string): DeskNav {
  const at = nav.surfaces.findIndex((surface) => surface.id === id)
  if (at < 0) return nav
  const surfaces = nav.surfaces.filter((_, index) => index !== at)
  if (nav.active !== id) return { surfaces, active: nav.active }
  const next = surfaces[at] ?? surfaces[at - 1] ?? null
  return { surfaces, active: next?.id ?? null }
}

export function closeOthers(nav: DeskNav, id: string): DeskNav {
  const keep = nav.surfaces.find((surface) => surface.id === id)
  return keep ? { surfaces: [keep], active: keep.id } : nav
}

export function closeRightOf(nav: DeskNav, id: string): DeskNav {
  const at = nav.surfaces.findIndex((surface) => surface.id === id)
  if (at < 0 || at === nav.surfaces.length - 1) return nav
  const surfaces = nav.surfaces.slice(0, at + 1)
  const active = surfaces.some((surface) => surface.id === nav.active) ? nav.active : surfaces[at]!.id
  return { surfaces, active }
}

export function closeAll(nav: DeskNav): DeskNav {
  return nav.surfaces.length === 0 ? nav : { surfaces: [], active: null }
}

export function moveSurface(nav: DeskNav, from: string, to: string): DeskNav {
  const at = nav.surfaces.findIndex((surface) => surface.id === from)
  const target = nav.surfaces.findIndex((surface) => surface.id === to)
  if (at < 0 || target < 0 || at === target) return nav
  const surfaces = [...nav.surfaces]
  const [moved] = surfaces.splice(at, 1)
  surfaces.splice(target, 0, moved!)
  return { ...nav, surfaces }
}

export function moveFiles(nav: DeskNav, from: string, to: string): DeskNav {
  const under = (path: string) => path === from || path.startsWith(`${from}/`)
  if (!nav.surfaces.some((surface) => surface.kind === "file" && under(surface.path))) return nav
  const moved = (surface: Surface): Surface =>
    surface.kind === "file" && under(surface.path) ? fileSurface(to + surface.path.slice(from.length)) : surface
  const surfaces: Surface[] = []
  for (const surface of nav.surfaces.map(moved)) {
    if (!surfaces.some((open) => open.id === surface.id)) surfaces.push(surface)
  }
  const current = nav.surfaces.find((surface) => surface.id === nav.active)
  return { surfaces, active: current ? moved(current).id : nav.active }
}

export function dropFiles(nav: DeskNav, path: string): DeskNav {
  const gone = (surface: Surface) =>
    surface.kind === "file" && (surface.path === path || surface.path.startsWith(`${path}/`))
  if (!nav.surfaces.some(gone)) return nav
  const surfaces = nav.surfaces.filter((surface) => !gone(surface))
  const active = surfaces.some((surface) => surface.id === nav.active) ? nav.active : (surfaces[0]?.id ?? null)
  return { surfaces, active }
}

export function showInActive(nav: DeskNav, path: string): DeskNav {
  const target = fileSurface(path)
  if (nav.surfaces.some((surface) => surface.id === target.id)) return openSurface(nav, target)
  const at = nav.surfaces.findIndex((surface) => surface.id === nav.active)
  if (nav.surfaces[at]?.kind !== "file") return openSurface(nav, target)
  return { surfaces: nav.surfaces.map((surface, index) => (index === at ? target : surface)), active: target.id }
}
