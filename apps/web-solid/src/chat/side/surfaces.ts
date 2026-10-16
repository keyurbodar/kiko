import { createSignal } from "solid-js"
import { rememberFile } from "../../files/recent"

/*
 * The right sidecar's tabs, per chat. This file is in the shell's tier and holds no UI: the
 * sidecar and the card load on first open. Every action is a local state change, so a tab
 * answers at once and never waits on the network.
 */
export type FixedKind = "files" | "memory" | "plate" | "routines" | "tasks"

export type Surface =
  | { id: "files"; kind: "files" }
  | { id: `file:${string}`; kind: "file"; path: string }
  | { id: "memory"; kind: "memory" }
  | { id: "plate"; kind: "plate" }
  | { id: "routines"; kind: "routines" }
  | { id: "tasks"; kind: "tasks" } // group chats only
  | { id: `agent:${string}`; kind: "agent"; slug: string }

export type SidecarState = { open: boolean; active: string | null; surfaces: Surface[] }

/** A line to scroll to in a file, set by `openFile`. `n` counts requests so a repeat is new. */
export type Reveal = { chatId: string; path: string; line: number | null; n: number }

const KEY = "kiko:sidecar:v1"
const EMPTY: SidecarState = { open: false, active: null, surfaces: [] }

const FIXED: { [K in FixedKind]: Extract<Surface, { kind: K }> } = {
  files: { id: "files", kind: "files" },
  memory: { id: "memory", kind: "memory" },
  plate: { id: "plate", kind: "plate" },
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

function write(value: string) {
  try {
    localStorage.setItem(KEY, value)
  } catch {}
}

/** Reads one stored surface. Anything that does not match the model is dropped. */
function parseSurface(value: unknown): Surface | null {
  if (typeof value !== "object" || value === null) return null
  const s = value as { kind?: unknown; path?: unknown; slug?: unknown }
  if (s.kind === "file") return typeof s.path === "string" ? fileSurface(s.path) : null
  if (s.kind === "agent") return typeof s.slug === "string" ? agentSurface(s.slug) : null
  if (s.kind === "files" || s.kind === "memory" || s.kind === "plate" || s.kind === "routines" || s.kind === "tasks") return fixedSurface(s.kind)
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

/** Applies one change to a chat's state. Returning the same object is a no-op and writes nothing. */
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

/** The tab next to a closed one: the one that slid into its place, else the one before it. */
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

/** Closes every tab and keeps the sidecar open, on the launcher. */
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

/** A rename moves the file tabs under `from` to their new paths, and keeps the active one. */
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

/** A delete closes the file tabs at `path` or under it. */
export function dropFileSurfaces(chatId: string, path: string) {
  for (const x of sidecarSurfaces(chatId)) {
    if (x.kind === "file" && (x.path === path || x.path.startsWith(`${path}/`))) closeSurface(chatId, x.id)
  }
}

/** Opens the file in its own tab and asks the viewer to reveal `line`. */
export function openFile(chatId: string, path: string, line?: number) {
  openSurface(chatId, fileSurface(path))
  rememberFile(chatId, path)
  setReveal({ chatId, path, line: line !== undefined && line > 0 ? line : null, n: (reveal()?.n ?? 0) + 1 })
}

/** Starts loading the sidecar's chunk. Safe to call any number of times: the module loads once. */
export const loadSidecar = () => import("./Sidecar")

export const sidecarOpen = (chatId: string): boolean => (all()[chatId] ?? EMPTY).open
export const sidecarSurfaces = (chatId: string): readonly Surface[] => (all()[chatId] ?? EMPTY).surfaces
export const activeSurface = (chatId: string): Surface | null => {
  const s = all()[chatId] ?? EMPTY
  return s.surfaces.find((x) => x.id === s.active) ?? null
}

/** The line `openFile` asked for in this file, until another request replaces it. */
export function fileReveal(chatId: string, path: string): { line: number | null; n: number } | null {
  const r = reveal()
  return r && r.chatId === chatId && r.path === path ? { line: r.line, n: r.n } : null
}

export type LauncherItem = { kind: FixedKind; label: string; key: string; group?: true }

/** The "Open a surface" rows, in order. The letter is the key that opens the row. */
export const LAUNCHER: readonly LauncherItem[] = [
  { kind: "files", label: "Files", key: "F" },
  { kind: "memory", label: "Memory", key: "M" },
  { kind: "plate", label: "On your plate", key: "P" },
  { kind: "routines", label: "Routines", key: "R" },
  { kind: "tasks", label: "Tasks", key: "T", group: true },
]

/** The launcher rows for a chat. Group-only rows are left out of a single chat. */
export function launcherEntries(group: boolean): LauncherItem[] {
  return LAUNCHER.filter((item) => group || !item.group)
}
