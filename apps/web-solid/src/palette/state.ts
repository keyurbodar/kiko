import { createRoot, createSignal } from "solid-js"
import { closeSettings } from "../settings/dialog-state"

const [stack, setStack] = createRoot(() => createSignal<readonly string[] | null>(null))

export const paletteStack = stack
export const openPalette = (view?: string) => {
  closeSettings()
  setStack(view ? [view] : [])
}
export const closePalette = () => setStack(null)
export const enterView = (id: string) => setStack((s) => (s ? [...s, id] : s))
export const backView = () => setStack((s) => (s && s.length ? s.slice(0, -1) : s))
