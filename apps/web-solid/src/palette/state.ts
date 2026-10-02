import { createRoot, createSignal } from "solid-js"

/*
 * Whether the palette is open, and which list it shows. Kept apart from the
 * panel so the registry's commands can open it without importing the panel,
 * which loads later as tier 3.
 */
export type PaletteMode = "commands" | "chats"

const [mode, setMode] = createRoot(() => createSignal<PaletteMode | null>(null))

export const paletteMode = mode
export const openPalette = (next: PaletteMode = "commands") => setMode(next)
export const closePalette = () => setMode(null)
