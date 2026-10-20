import { createRoot, createSignal } from "solid-js"

const [stack, setStack] = createRoot(() => createSignal<readonly string[] | null>(null))

export const paletteStack = stack
export const openPalette = (view?: string) => setStack(view ? [view] : [])
export const closePalette = () => setStack(null)
export const enterView = (id: string) => setStack((s) => (s ? [...s, id] : s))
export const backView = () => setStack((s) => (s && s.length ? s.slice(0, -1) : s))
