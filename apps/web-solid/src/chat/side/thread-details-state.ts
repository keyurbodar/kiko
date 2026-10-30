import { createSignal } from "solid-js"
import {
  isDefaultThreadDetailsVisibility,
  readThreadDetailsChoice,
  RESET_THREAD_DETAILS,
  resolveThreadDetailsVisibility,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
  type ThreadDetailsChoice,
  type ThreadDetailsItemId,
  type ThreadDetailsVisibility,
} from "./thread-details-items"

const OPEN_KEY = "kiko:thread-details:open:v1"
const ITEMS_KEY = "kiko:thread-details:v1"

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function readOpen(): Record<string, boolean> {
  const raw = read(OPEN_KEY)
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [chatId, value] of Object.entries(raw)) if (typeof value === "boolean") out[chatId] = value
  return out
}

const [openByChat, setOpenByChat] = createSignal<Readonly<Record<string, boolean>>>(readOpen())
const [choice, setChoice] = createSignal<ThreadDetailsChoice>(readThreadDetailsChoice(read(ITEMS_KEY)))

export function threadDetailsOpen(chatId: string, fallback: boolean): boolean {
  return openByChat()[chatId] ?? fallback
}

export function setThreadDetailsOpen(chatId: string, value: boolean) {
  setOpenByChat((map) => {
    if (map[chatId] === value) return map
    const next = { ...map, [chatId]: value }
    write(OPEN_KEY, next)
    return next
  })
}

export const threadDetailsVisibility = (): ThreadDetailsVisibility => resolveThreadDetailsVisibility(choice())

export const threadDetailsDefault = (): boolean => isDefaultThreadDetailsVisibility(threadDetailsVisibility())

export function setThreadDetailsVisible(id: ThreadDetailsItemId, visible: boolean) {
  const item = THREAD_DETAILS_ITEMS.find((entry) => entry.id === id)
  if (!item) return
  setChoice((current) => {
    const next = setThreadDetailsItem(current, item, visible)
    write(ITEMS_KEY, next)
    return next
  })
}

export function resetThreadDetails() {
  setChoice(RESET_THREAD_DETAILS)
  write(ITEMS_KEY, RESET_THREAD_DETAILS)
}
