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
  | { kind: "record"; id: string }
  | { kind: "links" }
  | { kind: "media" }
  | { kind: "files" }
  | { kind: "agent"; slug: string }
  | { kind: "model" }

const HOME: InfoView = { kind: "home" }

export const MIN_WIDTH = 280
export const MAX_WIDTH = 560
export const DEFAULT_WIDTH = 360

const OPEN_KEY = "kiko:info-open"
const WIDTH_KEY = "kiko:info-width"

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

const [open, setOpen] = createSignal(read(OPEN_KEY) === "1")
const [stack, setStack] = createSignal<InfoView[]>([HOME])
const [width, setWidthSignal] = createSignal(clampWidth(Number(read(WIDTH_KEY)) || DEFAULT_WIDTH))

/** True while the panel is open. It stays open as the reader moves between chats. */
export const infoOpen = open
export const infoView = () => stack().at(-1) ?? HOME
export const infoDepth = () => stack().length
export const infoWidth = width

function setOpenSaved(value: boolean) {
  setOpen(value)
  write(OPEN_KEY, value ? "1" : "0")
}

/** Opens the panel. With a view it opens on that view, with the home card underneath. */
export function openInfo(view?: InfoView) {
  if (view) setStack(view.kind === "home" ? [HOME] : [HOME, view])
  setOpenSaved(true)
}

export function closeInfo() {
  setOpenSaved(false)
}

export function toggleInfo() {
  if (open()) closeInfo()
  else openInfo()
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
