import { createRoot, createSignal } from "solid-js"

const [open, setOpen] = createRoot(() => createSignal(false))

export const botPickerOpen = open
export const openBotPicker = () => setOpen(true)

export const closeBotPicker = () => setOpen(false)
