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
  | { kind: "tasks" }

const HOME: InfoView = { kind: "home" }

export const MIN_WIDTH = 280
export const MAX_WIDTH = 560
export const DEFAULT_WIDTH = 360
/** An open file widens the panel, the way t3code's file preview does. */
export const FILE_MIN_WIDTH = 420
export const FILE_MAX_WIDTH = 1200
export const FILE_DEFAULT_WIDTH = 760

/** The panel's two tabs. */
export type InfoTab = "info" | "files"

const OPEN_KEY = "kiko:info-open"
const WIDTH_KEY = "kiko:info-width"
const FILE_WIDTH_KEY = "kiko:info-file-width"
const TAB_KEY = "kiko:info-tab"

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
export const clampFileWidth = (width: number) => Math.min(FILE_MAX_WIDTH, Math.max(FILE_MIN_WIDTH, Math.round(width)))

const [open, setOpen] = createSignal(read(OPEN_KEY) === "1")
const [stack, setStack] = createSignal<InfoView[]>([HOME])
const [width, setWidthSignal] = createSignal(clampWidth(Number(read(WIDTH_KEY)) || DEFAULT_WIDTH))
const [fileWidth, setFileWidthSignal] = createSignal(clampFileWidth(Number(read(FILE_WIDTH_KEY)) || FILE_DEFAULT_WIDTH))
const [tab, setTabSignal] = createSignal<InfoTab>(read(TAB_KEY) === "files" ? "files" : "info")
/** The open file's path, per chat. A chat with no entry shows its tree. */
const [files, setFiles] = createSignal<Readonly<Record<string, string>>>({})

/** True while the panel is open. It stays open as the reader moves between chats. */
export const infoOpen = open
export const infoView = () => stack().at(-1) ?? HOME
export const infoDepth = () => stack().length
export const infoTab = tab
/** The file open in a chat's files tab, or null for the tree alone. */
export const openFilePath = (chatId: string): string | null => files()[chatId] ?? null
/** The panel's width right now: wide while the files tab shows a file. */
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

/** Opens the files tab on a chat, with a file when `path` is given. */
export function openFile(chatId: string, path: string | null) {
  setFiles((all) => {
    const next = { ...all }
    if (path) next[chatId] = path
    else delete next[chatId]
    return next
  })
  setInfoTab("files")
  setOpenSaved(true)
}

/** Back to the tree. The panel stays open. */
export function closeFile(chatId: string) {
  setFiles((all) => {
    const next = { ...all }
    delete next[chatId]
    return next
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
