import { createSignal } from "solid-js"
import { rememberFile } from "../../files/recent"

export type FixedKind = "files" | "memory" | "routines" | "tasks"

export type Surface =
  | { id: "files"; kind: "files" }
  | { id: `file:${string}`; kind: "file"; path: string }
  | { id: "memory"; kind: "memory" }
  | { id: "routines"; kind: "routines" }
  | { id: "tasks"; kind: "tasks" }
  | { id: `agent:${string}`; kind: "agent"; slug: string }

export type SidecarState = { open: boolean; active: string | null; surfaces: Surface[] }

export type Reveal = { chatId: string; path: string; line: number | null; n: number }

const KEY = "kiko:sidecar:v1"
const EMPTY: SidecarState = { open: false, active: null, surfaces: [] }

const FIXED: { [K in FixedKind]: Extract<Surface, { kind: K }> } = {
  files: { id: "files", kind: "files" },
  memory: { id: "memory", kind: "memory" },
  routines: { id: "routines", kind: "routines" },
  tasks: { id: "tasks", kind: "tasks" },
}
export const fixedSurface = (kind: FixedKind): Surface => FIXED[kind]
export const fileSurface = (path: string): Surface => ({ id: `file:${path}`, kind: "file", path })
export const agentSurface = (slug: string): Surface => ({ id: `agent:${slug}`, kind: "agent", slug })

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

let writing: ReturnType<typeof setTimeout> | undefined
let pending: string | null = null

function write(value: string) {
  pending = value
  if (writing !== undefined) return
  writing = setTimeout(() => {
    writing = undefined
    const out = pending
    pending = null
    if (out === null) return
    try {
      localStorage.setItem(KEY, out)
    } catch {}
  }, 250)
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || pending === null) return
    const out = pending
    pending = null
    try {
      localStorage.setItem(KEY, out)
    } catch {}
  })
}

function parseSurface(value: unknown): Surface | null {
  if (typeof value !== "object" || value === null) return null
  const s = value as { kind?: unknown; path?: unknown; slug?: unknown }
  if (s.kind === "file") return typeof s.path === "string" ? fileSurface(s.path) : null
  if (s.kind === "agent") return typeof s.slug === "string" ? agentSurface(s.slug) : null
  if (s.kind === "files" || s.kind === "memory" || s.kind === "routines" || s.kind === "tasks") return fixedSurface(s.kind)
  return null
}

function parseState(value: unknown): SidecarState | null {
  if (typeof value !== "object" || value === null) return null
  const { open, active, surfaces } = value as { open?: unknown; active?: unknown; surfaces?: unknown }
  if (typeof open !== "boolean" || !Array.isArray(surfaces)) return null
  const list: Surface[] = []
  for (const item of surfaces) {
    const surface = parseSurface(item)
    if (surface && !list.some((s) => s.id === surface.id)) list.push(surface)
  }
  const activeId = typeof active === "string" && list.some((s) => s.id === active) ? active : null
  return { open, active: activeId, surfaces: list }
}

function readAll(): Record<string, SidecarState> {
  const saved = read()
  if (saved === null) return {}
  let raw: unknown
  try {
    raw = JSON.parse(saved)
  } catch {
    return {}
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, SidecarState> = {}
  for (const [chatId, value] of Object.entries(raw)) {
    const state = parseState(value)
    if (state) out[chatId] = state
  }
  return out
}

const [all, setAll] = createSignal<Readonly<Record<string, SidecarState>>>(readAll())
const [reveal, setReveal] = createSignal<Reveal | null>(null)

function edit(chatId: string, change: (s: SidecarState) => SidecarState) {
  setAll((map) => {
    const before = map[chatId] ?? EMPTY
    const after = change(before)
    if (after === before) return map
    const next = { ...map, [chatId]: after }
    write(JSON.stringify(next))
    return next
  })
}

function neighbor(list: readonly Surface[], at: number): string | null {
  return (list[at] ?? list[at - 1])?.id ?? null
}

export function openSurface(chatId: string, surface: Surface) {
  edit(chatId, (s) => ({
    open: true,
    active: surface.id,
    surfaces: s.surfaces.some((x) => x.id === surface.id) ? s.surfaces : [...s.surfaces, surface],
  }))
}

export function activateSurface(chatId: string, id: string) {
  edit(chatId, (s) => (s.active !== id && s.surfaces.some((x) => x.id === id) ? { ...s, active: id } : s))
}

export function closeSurface(chatId: string, id: string) {
  edit(chatId, (s) => {
    const at = s.surfaces.findIndex((x) => x.id === id)
    if (at < 0) return s
    const surfaces = s.surfaces.filter((_, i) => i !== at)
    return { ...s, surfaces, active: s.active === id ? neighbor(surfaces, at) : s.active }
  })
}

export function closeOthers(chatId: string, id: string) {
  edit(chatId, (s) => {
    const keep = s.surfaces.find((x) => x.id === id)
    return keep ? { ...s, surfaces: [keep], active: id } : s
  })
}

export function closeToRight(chatId: string, id: string) {
  edit(chatId, (s) => {
    const at = s.surfaces.findIndex((x) => x.id === id)
    if (at < 0 || at === s.surfaces.length - 1) return s
    const surfaces = s.surfaces.slice(0, at + 1)
    return { ...s, surfaces, active: surfaces.some((x) => x.id === s.active) ? s.active : id }
  })
}

export function closeAll(chatId: string) {
  edit(chatId, (s) => ({ ...s, surfaces: [], active: null }))
}

export function moveSurface(chatId: string, id: string, toIndex: number) {
  edit(chatId, (s) => {
    const from = s.surfaces.findIndex((x) => x.id === id)
    if (from < 0) return s
    const moved = s.surfaces[from]
    const rest = s.surfaces.filter((_, i) => i !== from)
    const at = Math.min(Math.max(toIndex, 0), rest.length)
    return { ...s, surfaces: [...rest.slice(0, at), moved, ...rest.slice(at)] }
  })
}

export function toggleSidecar(chatId: string) {
  edit(chatId, (s) => ({ ...s, open: !s.open }))
}

export function closeSidecar(chatId: string) {
  edit(chatId, (s) => (s.open ? { ...s, open: false } : s))
}

export function moveFileSurfaces(chatId: string, from: string, to: string) {
  edit(chatId, (s) => {
    const under = (p: string) => p === from || p.startsWith(`${from}/`)
    const moved = (x: Surface): Surface => (x.kind === "file" && under(x.path) ? fileSurface(to + x.path.slice(from.length)) : x)
    if (!s.surfaces.some((x) => moved(x) !== x)) return s
    const surfaces: Surface[] = []
    for (const x of s.surfaces.map(moved)) if (!surfaces.some((y) => y.id === x.id)) surfaces.push(x)
    const was = s.surfaces.find((x) => x.id === s.active)
    const next = was ? moved(was).id : null
    return { ...s, surfaces, active: surfaces.some((x) => x.id === next) ? next : null }
  })
}

export function dropFileSurfaces(chatId: string, path: string) {
  for (const x of sidecarSurfaces(chatId)) {
    if (x.kind === "file" && (x.path === path || x.path.startsWith(`${path}/`))) closeSurface(chatId, x.id)
  }
}

export function dropAgentSurfaces(chatId: string, gone: (slug: string) => boolean) {
  for (const x of sidecarSurfaces(chatId)) if (x.kind === "agent" && gone(x.slug)) closeSurface(chatId, x.id)
}

export function openFile(chatId: string, path: string, line?: number) {
  openSurface(chatId, fileSurface(path))
  rememberFile(chatId, path)
  setReveal({ chatId, path, line: line !== undefined && line > 0 ? line : null, n: (reveal()?.n ?? 0) + 1 })
}

export const loadSidecar = () => import("./Sidecar")

export const sidecarOpen = (chatId: string): boolean => (all()[chatId] ?? EMPTY).open
export const sidecarSurfaces = (chatId: string): readonly Surface[] => (all()[chatId] ?? EMPTY).surfaces
export const activeSurface = (chatId: string): Surface | null => {
  const s = all()[chatId] ?? EMPTY
  return s.surfaces.find((x) => x.id === s.active) ?? s.surfaces[0] ?? null
}

export function fileReveal(chatId: string, path: string): { line: number | null; n: number } | null {
  const r = reveal()
  return r && r.chatId === chatId && r.path === path ? { line: r.line, n: r.n } : null
}

export type LauncherItem = { kind: FixedKind; label: string; key: string; group?: true }

export const LAUNCHER: readonly LauncherItem[] = [
  { kind: "files", label: "Files", key: "F" },
  { kind: "memory", label: "Memory", key: "M" },
  { kind: "routines", label: "Routines", key: "R" },
  { kind: "tasks", label: "Tasks", key: "T", group: true },
]

export function launcherEntries(group: boolean): LauncherItem[] {
  return LAUNCHER.filter((item) => group || !item.group)
}
