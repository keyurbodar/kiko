import { createSignal } from "solid-js"
import { rememberFile } from "../../files/recent"
import {
  back,
  closeFile,
  closeFiles,
  closeRightOf,
  type DeskNav,
  dropFiles,
  EMPTY_NAV,
  type FileSurface,
  fileSurface,
  keepOnly,
  moveFiles,
  openView,
} from "./desk-nav"
import { type FixedKind, loadPanelViews, PANELS, type PanelKind, panelOf, type Surface } from "./panels"

export type { FixedKind, Surface }

export type Reveal = { chatId: string; path: string; line: number | null; n: number }

const KEY = "kiko:desk:v1"
const SHOWN_KEY = "kiko:device:card"

export const fixedSurface = (kind: FixedKind): Surface => ({ id: kind, kind }) as Surface
export const agentSurface = (slug: string): Surface => ({
  id: PANELS.agent.instance!.id({ slug }),
  kind: "agent",
  slug,
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
  const { view, files } = value as { view?: unknown; files?: unknown }
  if (!Array.isArray(files)) return null
  const list: FileSurface[] = []
  for (const item of files) {
    const surface = parseSurface(item)
    if (surface?.kind === "file" && !list.some((s) => s.id === surface.id)) list.push(surface)
  }
  return { view: parseSurface(view), files: list }
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
const [docked, setDocked] = createSignal(readKey(SHOWN_KEY) !== "0")
const [popped, setPopped] = createSignal(false)
const [compact, setCompact] = createSignal(false)

export const setDeskCompact = (value: boolean) => setCompact(value)

export const deskShown = (): boolean => (compact() ? popped() : docked())

function setShown(next: boolean) {
  if (compact()) return setPopped(next)
  setDocked(next)
  writeKey(SHOWN_KEY, next ? "1" : "0")
}

export const toggleDesk = () => setShown(!deskShown())
export const closeDesk = () => deskShown() && setShown(false)

export const deskView = (chatId: string): Surface | null => (all()[chatId] ?? EMPTY_NAV).view
export const openFiles = (chatId: string): readonly FileSurface[] => (all()[chatId] ?? EMPTY_NAV).files

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
  edit(chatId, (nav) => openView(nav, surface))
  if (!deskShown()) setShown(true)
}

export const deskBack = (chatId: string) => edit(chatId, back)
export const closeSurface = (chatId: string, id: string) => edit(chatId, (nav) => closeFile(nav, id))
export const closeOthers = (chatId: string, id: string) => edit(chatId, (nav) => keepOnly(nav, id))
export const closeToRight = (chatId: string, id: string) => edit(chatId, (nav) => closeRightOf(nav, id))
export const closeAll = (chatId: string) => edit(chatId, (nav) => ({ ...closeFiles(nav), view: null }))
export const closeTabs = (chatId: string) => edit(chatId, closeFiles)

export function activateSurface(chatId: string, id: string) {
  const file = openFiles(chatId).find((f) => f.id === id)
  if (file) edit(chatId, (nav) => openView(nav, file))
}

export const moveFileSurfaces = (chatId: string, from: string, to: string) =>
  edit(chatId, (nav) => moveFiles(nav, from, to))

export const dropFileSurfaces = (chatId: string, path: string) => edit(chatId, (nav) => dropFiles(nav, path))

export function openFile(chatId: string, path: string, line?: number) {
  openSurface(chatId, fileSurface(path))
  rememberFile(chatId, path)
  setReveal({ chatId, path, line: line !== undefined && line > 0 ? line : null, n: (reveal()?.n ?? 0) + 1 })
}

export const loadDesk = () => Promise.all([import("./Desk"), loadPanelViews()]).then(([desk]) => desk)

export function fileReveal(chatId: string, path: string): { line: number | null; n: number } | null {
  const r = reveal()
  return r && r.chatId === chatId && r.path === path ? { line: r.line, n: r.n } : null
}
