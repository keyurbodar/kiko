import { createSignal, type JSX } from "solid-js"

/*
 * The chat info panel's open state. This file is in the shell's tier and holds no UI: the
 * panel itself (`panel.tsx`) loads on first open, so the chat route does not grow.
 *
 * The panel shows the stack's last view. `home` is the card list. A card pushes its full
 * list on top, and the back arrow pops it.
 */
export type InfoView =
  | { kind: "home" }
  | { kind: "memory" }
  | { kind: "agent"; slug: string }
  | { kind: "soul"; slug: string }
  | { kind: "routines" }
  | { kind: "tasks" }

const HOME: InfoView = { kind: "home" }

export const MIN_WIDTH = 280
export const MAX_WIDTH = 560
export const DEFAULT_WIDTH = 340
/** Open files widen the panel to t3code's preview width. Its upper bound follows the window. */
export const FILE_MIN_WIDTH = 360
export const FILE_DEFAULT_WIDTH = 540
export const fileMaxWidth = () => (typeof window === "undefined" ? 1200 : Math.max(FILE_MIN_WIDTH, Math.round(window.innerWidth * 0.7)))

/** The panel's two tabs. */
export type InfoTab = "info" | "files"

const OPEN_KEY = "yuki:info-open"
const WIDTH_KEY = "yuki:info-width"
const FILE_WIDTH_KEY = "yuki:info-file-width"
const TAB_KEY = "yuki:info-tab"
const FILE_TABS_KEY = "yuki:file-tabs"

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

/** Starts loading the panel's chunk. Safe to call any number of times: the module loads once. */
export const loadInfoPanel = () => import("./panel")

export const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))
export const clampFileWidth = (width: number) => Math.min(fileMaxWidth(), Math.max(FILE_MIN_WIDTH, Math.round(width)))

// Below 768 px the panel covers the chat, so like the sidebar drawer it starts closed on every load.
const narrowAtLoad = typeof matchMedia === "function" && matchMedia("(width < 768px)").matches
const [open, setOpen] = createSignal(read(OPEN_KEY) === "1" && !narrowAtLoad)
const [stack, setStack] = createSignal<InfoView[]>([HOME])
const [width, setWidthSignal] = createSignal(clampWidth(Number(read(WIDTH_KEY)) || DEFAULT_WIDTH))
const [fileWidth, setFileWidthSignal] = createSignal(clampFileWidth(Number(read(FILE_WIDTH_KEY)) || FILE_DEFAULT_WIDTH))
const [tab, setTabSignal] = createSignal<InfoTab>(read(TAB_KEY) === "files" ? "files" : "info")
/*
 * The files tab's open files, per chat, as t3code's right panel keeps its surfaces: a tab per
 * path, the active one, and the recently closed for reopen. `active` is null only when there are
 * no tabs. Tabs and the active one are saved, so a reload finds them; the closed list is not.
 */
export type FileTabs = { readonly tabs: readonly string[]; readonly active: string | null; readonly closed: readonly string[] }
const NO_TABS: FileTabs = { tabs: [], active: null, closed: [] }
const MAX_CLOSED = 20

function readTabs(): Record<string, FileTabs> {
  try {
    const saved = JSON.parse(read(FILE_TABS_KEY) ?? "{}") as Record<string, { tabs?: unknown; active?: unknown }>
    const out: Record<string, FileTabs> = {}
    for (const [chat, t] of Object.entries(saved)) {
      const tabs = Array.isArray(t.tabs) ? t.tabs.filter((p): p is string => typeof p === "string") : []
      if (tabs.length) out[chat] = { tabs, active: typeof t.active === "string" && tabs.includes(t.active) ? t.active : tabs[0]!, closed: [] }
    }
    return out
  } catch {
    return {}
  }
}

/** Adds `path` as a tab if it is not one, and makes it active. */
export function withOpened(t: FileTabs, path: string): FileTabs {
  return { tabs: t.tabs.includes(path) ? t.tabs : [...t.tabs, path], active: path, closed: t.closed.filter((p) => p !== path) }
}

/** Removes a tab. Closing the active one activates its right neighbour, else its left. */
export function withClosed(t: FileTabs, path: string, remember = true): FileTabs {
  const at = t.tabs.indexOf(path)
  if (at === -1) return t
  const tabs = t.tabs.filter((p) => p !== path)
  const active = t.active === path ? (tabs[at] ?? tabs[at - 1] ?? null) : t.active
  return { tabs, active, closed: remember ? [path, ...t.closed.filter((p) => p !== path)].slice(0, MAX_CLOSED) : t.closed }
}

const [fileTabs, setFileTabs] = createSignal<Readonly<Record<string, FileTabs>>>(readTabs())
/** A line to scroll to and mark in a file's source, set by `openFile`. `n` counts requests. */
const [reveal, setReveal] = createSignal<{ chatId: string; path: string; line: number; n: number } | null>(null)

function updateTabs(chatId: string, change: (t: FileTabs) => FileTabs) {
  setFileTabs((all) => {
    const next = { ...all, [chatId]: change(all[chatId] ?? NO_TABS) }
    if (!next[chatId]!.tabs.length && !next[chatId]!.closed.length) delete next[chatId]
    const saved: Record<string, { tabs: readonly string[]; active: string | null }> = {}
    for (const [chat, t] of Object.entries(next)) if (t.tabs.length) saved[chat] = { tabs: t.tabs, active: t.active }
    write(FILE_TABS_KEY, JSON.stringify(saved))
    return next
  })
}

/** True while the panel is open. It stays open as the reader moves between chats. */
export const infoOpen = open
export const infoView = () => stack().at(-1) ?? HOME
export const infoDepth = () => stack().length
export const infoTab = tab
/** A chat's open files. */
export const fileTabsOf = (chatId: string): FileTabs => fileTabs()[chatId] ?? NO_TABS
/** The active file tab in a chat, or null when it has none and the tab shows its tree. */
export const openFilePath = (chatId: string): string | null => fileTabsOf(chatId).active
/** The line `openFile` asked for in this file, until another request replaces it. */
export const fileReveal = (chatId: string, path: string) => {
  const r = reveal()
  return r && r.chatId === chatId && r.path === path ? { line: r.line, n: r.n } : null
}
/** The panel's width right now: wide while the files tab has open files. */
export const panelWidth = (chatId: string | null) =>
  tab() === "files" && chatId && openFilePath(chatId) ? fileWidth() : width()
export const infoWidth = width

function setOpenSaved(value: boolean) {
  setOpen(value)
  write(OPEN_KEY, value ? "1" : "0")
}

/** Opens the panel. With a view it opens on that view, with the home card underneath. */
export function openInfo(view?: InfoView) {
  if (view) setStack(view.kind === "home" ? [HOME] : [HOME, view])
  setInfoTab("info")
  setOpenSaved(true)
}

export function closeInfo() {
  setOpenSaved(false)
}

/** ⌘I. Opens on the info tab, and closes the panel when it already shows info. */
export function toggleInfo() {
  if (open() && tab() === "info") return closeInfo()
  setInfoTab("info")
  openInfo()
}

export function setInfoTab(value: InfoTab) {
  setTabSignal(value)
  write(TAB_KEY, value)
}

/** ⌘⇧E. Opens on the files tab, and closes the panel when it already shows files. */
export function toggleFiles() {
  if (open() && tab() === "files") return closeInfo()
  setInfoTab("files")
  setOpenSaved(true)
}

/**
 * Opens the files tab on a chat. A `path` opens it as a tab, or activates its tab; null keeps the
 * tabs as they are. A `line` scrolls the file's source to that line and marks it.
 */
export function openFile(chatId: string, path: string | null, line?: number) {
  if (path) {
    updateTabs(chatId, (t) => withOpened(t, path))
    if (line && line > 0) setReveal((r) => ({ chatId, path, line, n: (r?.n ?? 0) + 1 }))
  }
  setInfoTab("files")
  setOpenSaved(true)
}

export function setActiveFile(chatId: string, path: string) {
  updateTabs(chatId, (t) => (t.tabs.includes(path) ? { ...t, active: path } : t))
}

/** Closes one tab, the active one when `path` is left out. It can be reopened. */
export function closeFile(chatId: string, path = openFilePath(chatId)) {
  if (path) updateTabs(chatId, (t) => withClosed(t, path))
}

/** Reopens the last closed tab. False when there is none. */
export function reopenClosedFile(chatId: string): boolean {
  const path = fileTabsOf(chatId).closed[0]
  if (!path) return false
  openFile(chatId, path)
  return true
}

/** A rename in the tree carries the tabs under `from` to their new paths. */
export function moveFileTabs(chatId: string, from: string, to: string) {
  const moved = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
  updateTabs(chatId, (t) => ({ tabs: [...new Set(t.tabs.map(moved))], active: t.active && moved(t.active), closed: t.closed.map(moved) }))
}

/** A delete in the tree closes the tabs under `path`, for good: there is nothing to reopen. */
export function dropFileTabs(chatId: string, path: string) {
  const under = (p: string) => p === path || p.startsWith(`${path}/`)
  updateTabs(chatId, (t) => {
    let next = t
    for (const p of t.tabs) if (under(p)) next = withClosed(next, p, false)
    return { ...next, closed: next.closed.filter((p) => !under(p)) }
  })
}

/** Shows a full list or a record on top of the current view. */
export function pushInfo(view: InfoView) {
  setStack((s) => [...s, view])
}

export function popInfo() {
  setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
}

export function resetInfo() {
  setStack([HOME])
}

export function setInfoWidth(value: number) {
  const next = clampWidth(value)
  setWidthSignal(next)
  write(WIDTH_KEY, String(next))
}

export function setFileWidth(value: number) {
  const next = clampFileWidth(value)
  setFileWidthSignal(next)
  write(FILE_WIDTH_KEY, String(next))
}

/*
 * Slots for sections that later tasks add: tasks and notes (P6-09) and reminders (P5-07). A
 * feature registers its section when it exists, and the panel draws it under the built-in
 * cards. Until then nothing is registered and nothing shows.
 */
export type InfoSection = {
  id: string
  title: string
  /** Draws the card body for this chat. */
  render: (chatId: string) => JSX.Element
  /** Shown while this returns true. Absent means always. */
  when?: (chatId: string) => boolean
}

const [extraSections, setExtraSections] = createSignal<readonly InfoSection[]>([])

export const infoSections = extraSections

export function registerInfoSection(section: InfoSection): () => void {
  setExtraSections((list) => [...list.filter((s) => s.id !== section.id), section])
  return () => setExtraSections((list) => list.filter((s) => s !== section))
}
