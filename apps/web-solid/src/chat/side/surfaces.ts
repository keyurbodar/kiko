import { createSignal } from "solid-js"
import { rememberFile } from "../../files/recent"
import {
  activateSurface as activate,
  closeAll as closeEvery,
  closeOthers as closeEveryOther,
  closeRightOf as closeEveryRightOf,
  closeSurface as closeOne,
  type DeskNav,
  deactivate,
  dropFiles,
  EMPTY_NAV,
  fileSurface,
  moveFiles,
  showInActive,
  moveSurface,
  openSurface as openIn,
} from "./desk-nav"
import { type FixedKind, loadPanelViews, PANELS, type PanelKind, panelOf, type Surface } from "./panels"

export type { FixedKind, Surface }

export type Reveal = { chatId: string; path: string; line: number | null; n: number }

const KEY = "kiko:desk:v1"
const SHOWN_KEY = "kiko:device:panel"
const MAX_KEY = "kiko:device:panel-max"

export const fixedSurface = (kind: FixedKind): Surface => ({ id: kind, kind }) as Surface
export const helperSurface = (helper: string, window: string): Surface => ({
  id: PANELS.helper.instance!.id({ helper, window }),
  kind: "helper",
  helper,
  window,
})

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {}
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
    if (out !== null) writeKey(KEY, out)
  }, 250)
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || pending === null) return
    const out = pending
    pending = null
    writeKey(KEY, out)
  })
}

function parseSurface(value: unknown): Surface | null {
  if (typeof value !== "object" || value === null) return null
  const raw = value as Record<string, unknown>
  const kind = raw.kind
  if (typeof kind !== "string" || !Object.hasOwn(PANELS, kind)) return null
  const instance = panelOf(kind as PanelKind).instance as
    | { id: (fields: object) => string; parse: (raw: Record<string, unknown>) => object | null }
    | undefined
  if (!instance) return fixedSurface(kind as FixedKind)
  const fields = instance.parse(raw)
  return fields ? ({ ...fields, kind, id: instance.id(fields) } as Surface) : null
}

function parseNav(value: unknown): DeskNav | null {
  if (typeof value !== "object" || value === null) return null
  const { surfaces, active, view, files } = value as {
    surfaces?: unknown
    active?: unknown
    view?: unknown
    files?: unknown
  }
  const legacy = !Array.isArray(surfaces)
  const raw = legacy ? [...(Array.isArray(files) ? files : []), ...(view === undefined ? [] : [view])] : surfaces
  if (!Array.isArray(raw)) return null
  const list: Surface[] = []
  for (const item of raw) {
    const surface = parseSurface(item)
    if (surface && !list.some((open) => open.id === surface.id)) list.push(surface)
  }
  const wanted = legacy ? (parseSurface(view)?.id ?? null) : typeof active === "string" ? active : null
  const found = list.some((surface) => surface.id === wanted)
  return { surfaces: list, active: found ? wanted : (list.at(-1)?.id ?? null) }
}

function readAll(): Record<string, DeskNav> {
  const saved = readKey(KEY)
  if (saved === null) return {}
  let raw: unknown
  try {
    raw = JSON.parse(saved)
  } catch {
    return {}
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, DeskNav> = {}
  for (const [chatId, value] of Object.entries(raw)) {
    const nav = parseNav(value)
    if (nav) out[chatId] = nav
  }
  return out
}

const [all, setAll] = createSignal<Readonly<Record<string, DeskNav>>>(readAll())
const [reveal, setReveal] = createSignal<Reveal | null>(null)
const [docked, setDocked] = createSignal(readKey(SHOWN_KEY) === "1")
const [popped, setPopped] = createSignal(false)
const [compact, setCompact] = createSignal(false)
const [maximized, setMaximized] = createSignal(readKey(MAX_KEY) === "1")

export const setDeskCompact = (value: boolean) => setCompact(value)

export const deskShown = (): boolean => (compact() ? popped() : docked())

function setShown(next: boolean) {
  if (!next) setMaximized(false)
  if (compact()) return setPopped(next)
  setDocked(next)
  writeKey(SHOWN_KEY, next ? "1" : "0")
}

export const toggleDesk = () => setShown(!deskShown())
export const closeDesk = () => deskShown() && setShown(false)

export const panelMaximized = (): boolean => maximized()
export function setPanelMaximized(value: boolean) {
  setMaximized(value)
  writeKey(MAX_KEY, value ? "1" : "0")
}
export const surfacesOf = (chatId: string): readonly Surface[] => (all()[chatId] ?? EMPTY_NAV).surfaces
export const deskView = (chatId: string): Surface | null => {
  const nav = all()[chatId] ?? EMPTY_NAV
  return nav.surfaces.find((surface) => surface.id === nav.active) ?? null
}
function edit(chatId: string, change: (nav: DeskNav) => DeskNav) {
  setAll((map) => {
    const before = map[chatId] ?? EMPTY_NAV
    const after = change(before)
    if (after === before) return map
    const next = { ...map, [chatId]: after }
    write(JSON.stringify(next))
    return next
  })
}

export function openSurface(chatId: string, surface: Surface) {
  edit(chatId, (nav) => openIn(nav, surface))
  if (!deskShown()) setShown(true)
}

export const showSurfaces = (chatId: string) => edit(chatId, deactivate)
export const activateSurface = (chatId: string, id: string) => edit(chatId, (nav) => activate(nav, id))
export const closeSurface = (chatId: string, id: string) => edit(chatId, (nav) => closeOne(nav, id))
export const closeOthers = (chatId: string, id: string) => edit(chatId, (nav) => closeEveryOther(nav, id))
export const closeToRight = (chatId: string, id: string) => edit(chatId, (nav) => closeEveryRightOf(nav, id))
export const closeAll = (chatId: string) => edit(chatId, closeEvery)

export const moveFileSurfaces = (chatId: string, from: string, to: string) =>
  edit(chatId, (nav) => moveFiles(nav, from, to))

export const dropFileSurfaces = (chatId: string, path: string) => edit(chatId, (nav) => dropFiles(nav, path))

export const showFileInTab = (chatId: string, path: string) => edit(chatId, (nav) => showInActive(nav, path))

export const moveTab = (chatId: string, from: string, to: string) => edit(chatId, (nav) => moveSurface(nav, from, to))

export function openFile(chatId: string, path: string, line?: number) {
  openSurface(chatId, fileSurface(path))
  rememberFile(chatId, path)
  setReveal({ chatId, path, line: line !== undefined && line > 0 ? line : null, n: (reveal()?.n ?? 0) + 1 })
}

export const loadDesk = () => Promise.all([import("./right-panel"), loadPanelViews()]).then(([panel]) => panel)

export function fileReveal(chatId: string, path: string): { line: number | null; n: number } | null {
  const r = reveal()
  return r && r.chatId === chatId && r.path === path ? { line: r.line, n: r.n } : null
}
