import { createSignal } from "solid-js"

const KEY = "kiko:recent-files:v1"
const KEEP = 20

function read(): Record<string, string[]> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
    const out: Record<string, string[]> = {}
    for (const [id, list] of Object.entries(raw)) if (Array.isArray(list)) out[id] = list.filter((p): p is string => typeof p === "string")
    return out
  } catch {
    return {}
  }
}

const [all, setAll] = createSignal<Readonly<Record<string, readonly string[]>>>(read())

export const recentFiles = (chatId: string): readonly string[] => all()[chatId] ?? []

export function rememberFile(chatId: string, path: string) {
  const next = { ...all(), [chatId]: [path, ...recentFiles(chatId).filter((p) => p !== path)].slice(0, KEEP) }
  setAll(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}
