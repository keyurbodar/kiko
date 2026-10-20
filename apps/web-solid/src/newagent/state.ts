import { createRoot, createSignal } from "solid-js"

const [open, setOpen] = createRoot(() => createSignal(false))

export const newAgentOpen = open
export const openNewAgent = () => setOpen(true)
export const closeNewAgent = () => setOpen(false)
