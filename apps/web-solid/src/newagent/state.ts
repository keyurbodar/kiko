import { createRoot, createSignal } from "solid-js"

/*
 * Whether the new agent form is open. Kept apart from the form so the palette, the new chat picker
 * and the sidebar can open it without importing it, which loads on first use.
 */
const [open, setOpen] = createRoot(() => createSignal(false))

export const newAgentOpen = open
export const openNewAgent = () => setOpen(true)
export const closeNewAgent = () => setOpen(false)
