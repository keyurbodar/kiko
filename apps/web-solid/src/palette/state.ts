import { createRoot, createSignal } from "solid-js"
import type { CommandId } from "../commands/ids"
import { closeSettings } from "../settings/open"

export const TABS = [
  { id: "all", label: "All" },
  { id: "chats", label: "Chats" },
  { id: "agents", label: "Agents" },
  { id: "files", label: "Files" },
  { id: "recipes", label: "Recipes" },
  { id: "settings", label: "Settings" },
] as const

export type PaletteTab = (typeof TABS)[number]["id"]

const [stack, setStack, tab, setTab, folder, setFolder, picked, setPicked] = createRoot(() => {
  const [s, setS] = createSignal<readonly string[] | null>(null)
  const [t, setT] = createSignal<PaletteTab>("all")
  const [f, setF] = createSignal<readonly string[]>([])
  const [p, setP] = createSignal<ReadonlySet<string>>(new Set())
  return [s, setS, t, setT, f, setF, p, setP] as const
})

export const paletteStack = stack
export const paletteTab = tab
export const filesFolder = folder
export const pickedFiles = picked

export const stepTab = (step: 1 | -1) =>
  setTab((now) => TABS[(TABS.findIndex((t) => t.id === now) + step + TABS.length) % TABS.length]!.id)
export const chooseTab = (id: PaletteTab) => setTab(id)
export const openFolder = (path: readonly string[]) => setFolder(path)
export const setPicks = (next: ReadonlySet<string>) => setPicked(next)

export const openPalette = (view?: CommandId) => {
  closeSettings()
  setTab("all")
  setFolder([])
  setPicked(new Set<string>())
  setStack(view ? [view] : [])
}
export const closePalette = () => setStack(null)
export const enterView = (id: string) => setStack((s) => (s ? [...s, id] : s))
export const backView = () => setStack((s) => (s && s.length ? s.slice(0, -1) : s))
