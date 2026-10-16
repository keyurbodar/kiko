import { createRoot, createSignal } from "solid-js"

/*
 * Whether the palette is open, and which list it shows. Kept apart from the
 * panel so the registry's commands can open it without importing the panel,
 * which loads later as tier 3.
 *
 * The stack holds the ids of the submenu commands entered so far. `[]` is the
 * root list and `null` is closed.
 */
const [stack, setStack] = createRoot(() => createSignal<readonly string[] | null>(null))

export const paletteStack = stack
/** Opens the palette on the root list, or straight into one command's submenu. */
export const openPalette = (view?: string) => setStack(view ? [view] : [])
export const closePalette = () => setStack(null)
export const enterView = (id: string) => setStack((s) => (s ? [...s, id] : s))
export const backView = () => setStack((s) => (s && s.length ? s.slice(0, -1) : s))
