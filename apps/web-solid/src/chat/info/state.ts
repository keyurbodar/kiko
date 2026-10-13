import { createSignal, type JSX } from "solid-js"

/*
 * The chat info panel's open state. This file is in the shell's tier and holds no UI: the
 * panel itself (`panel.tsx`) loads on first open, so the chat route does not grow.
 *
 * The panel shows the stack's last view. `home` is the stacked sections. A row pushes its full
 * list on top, and the back arrow pops it.
 */
export type InfoView =
  | { kind: "home" }
  | { kind: "memory" }
  | { kind: "agent"; slug: string }
  | { kind: "soul"; slug: string }
  | { kind: "routines" }
  | { kind: "plate" }

const HOME: InfoView = { kind: "home" }

/** The panel's stacked sections, in order. Each is a collapsible band. */
export type SectionId = "context" | "agents" | "tasks" | "files"
export const SECTION_IDS: readonly SectionId[] = ["context", "agents", "tasks", "files"]

const OPEN_KEY = "kiko:info-open"
const SECTIONS_KEY = "kiko:info-sections"
const FILE_KEY = "kiko:info-file"

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

function readSections(): ReadonlySet<SectionId> {
  const saved = read(SECTIONS_KEY)
  if (saved === null) return new Set<SectionId>(["context"])
  try {
    const list: unknown = JSON.parse(saved)
    return new Set(Array.isArray(list) ? SECTION_IDS.filter((id) => list.includes(id)) : [])
  } catch {
    return new Set()
  }
}

function readFiles(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(read(FILE_KEY) ?? "{}")
    const out: Record<string, string> = {}
    if (saved && typeof saved === "object") for (const [chat, path] of Object.entries(saved)) if (typeof path === "string") out[chat] = path
    return out
  } catch {
    return {}
  }
}

// Below 768 px the panel covers the chat, so like the sidebar drawer it starts closed on every load.
const narrowAtLoad = typeof matchMedia === "function" && matchMedia("(width < 768px)").matches
const [open, setOpen] = createSignal(read(OPEN_KEY) === "1" && !narrowAtLoad)
const [stack, setStack] = createSignal<InfoView[]>([HOME])
const [sections, setSections] = createSignal<ReadonlySet<SectionId>>(readSections())
/** One open file per chat. The Files section shows it in place of the tree. */
const [files, setFiles] = createSignal<Readonly<Record<string, string>>>(readFiles())
/** A line to scroll to and mark in a file's source, set by `openFile`. `n` counts requests. */
const [reveal, setReveal] = createSignal<{ chatId: string; path: string; line: number; n: number } | null>(null)
/** The section a letter hint or a command asked to show. `n` counts requests so the same one can repeat. */
const [focused, setFocused] = createSignal<{ id: SectionId; n: number } | null>(null)

function setOpenFile(chatId: string, path: string | null) {
  setFiles((all) => {
    const next = { ...all }
    if (path) next[chatId] = path
    else delete next[chatId]
    write(FILE_KEY, JSON.stringify(next))
    return next
  })
}

/** True while the panel is open. It stays open as the reader moves between chats. */
export const infoOpen = open
export const infoView = () => stack().at(-1) ?? HOME
export const infoDepth = () => stack().length
export const openSections = sections
export const sectionFocus = focused
/** The file open in a chat, or null when the Files section shows its tree. */
export const openFilePath = (chatId: string): string | null => files()[chatId] ?? null
/** The line `openFile` asked for in this file, until another request replaces it. */
export const fileReveal = (chatId: string, path: string) => {
  const r = reveal()
  return r && r.chatId === chatId && r.path === path ? { line: r.line, n: r.n } : null
}

function setOpenSaved(value: boolean) {
  setOpen(value)
  write(OPEN_KEY, value ? "1" : "0")
}

export function setSectionOpen(id: SectionId, value: boolean) {
  setSections((all) => {
    if (all.has(id) === value) return all
    const next = new Set(all)
    if (value) next.add(id)
    else next.delete(id)
    write(SECTIONS_KEY, JSON.stringify([...next]))
    return next
  })
}

/** Opens the panel on the section list, with `id` open and scrolled into view. A pushed page is popped. */
export function showSection(id: SectionId) {
  setStack([HOME])
  setSectionOpen(id, true)
  setFocused((f) => ({ id, n: (f?.n ?? 0) + 1 }))
  setOpenSaved(true)
}

/** Opens the panel. With a view it opens on that view, with the home card underneath. */
export function openInfo(view?: InfoView) {
  if (view) setStack(view.kind === "home" ? [HOME] : [HOME, view])
  setOpenSaved(true)
}

export function closeInfo() {
  setOpenSaved(false)
}

/** ⌘I. */
export function toggleInfo() {
  if (open()) closeInfo()
  else openInfo()
}

/** The Files command. Closes the panel when Files is already showing. */
export function toggleFiles() {
  if (open() && sections().has("files")) return closeInfo()
  showSection("files")
}

/**
 * Opens a file in the Files section of a chat's panel. A `line` scrolls the file's source to that
 * line and marks it. A null `path` only shows the section.
 */
export function openFile(chatId: string, path: string | null, line?: number) {
  if (path) {
    setOpenFile(chatId, path)
    if (line && line > 0) setReveal((r) => ({ chatId, path, line, n: (r?.n ?? 0) + 1 }))
  }
  showSection("files")
}

/** The back arrow: leaves the open file and shows the tree. */
export function closeFile(chatId: string) {
  setOpenFile(chatId, null)
}

/** A rename in the tree carries the open file to its new path. */
export function moveOpenFile(chatId: string, from: string, to: string) {
  const path = openFilePath(chatId)
  if (path && (path === from || path.startsWith(`${from}/`))) setOpenFile(chatId, to + path.slice(from.length))
}

/** A delete in the tree closes the open file when it was under `path`. */
export function dropOpenFile(chatId: string, path: string) {
  const open = openFilePath(chatId)
  if (open && (open === path || open.startsWith(`${path}/`))) setOpenFile(chatId, null)
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
