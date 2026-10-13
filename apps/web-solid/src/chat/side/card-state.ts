import { createSignal } from "solid-js"

/*
 * The chat card's open state. The card floats over the thread, so it is a plain signal: closed on
 * every load and never saved. This file is in the shell's tier and holds no UI. The card loads on
 * first open, so the chat route does not carry it.
 */
const [open, setOpen] = createSignal(false)

export const cardOpen = open
export const toggleCard = () => setOpen((value) => !value)
export const closeCard = () => setOpen(false)

/** Starts loading the card's chunk. Safe to call any number of times: the module loads once. */
export const loadCard = () => import("./Card")
