import { createSignal } from "solid-js"
import { cardPlacement, type Placement } from "./card/placement"

/*
 * The chat card's state. Inline, the card is pinned at the top right and its open state is saved.
 * Popover, the card is closed until the toggle opens it and is never saved. The placement follows
 * the chat panel's width (shell.tsx). This file is in the shell's tier and holds no UI. The card
 * loads on first open, so the chat route does not carry it.
 */
const INLINE_KEY = "kiko:card-inline"

function readInline() {
  try {
    return localStorage.getItem(INLINE_KEY) !== "0"
  } catch {
    return true
  }
}

function writeInline(value: boolean) {
  try {
    localStorage.setItem(INLINE_KEY, value ? "1" : "0")
  } catch {}
}

const [placement, setPlacement] = createSignal<Placement>("inline")
const [inlineOpen, setInlineOpen] = createSignal(readInline())
const [popoverOpen, setPopoverOpen] = createSignal(false)

export const currentPlacement = placement

/** Called with the chat panel's width. A flip closes the popover, so it always starts closed. */
export function setCardPanelWidth(width: number) {
  const next = cardPlacement(width)
  if (next === placement()) return
  setPlacement(next)
  setPopoverOpen(false)
}

/** Whether the card shows in the current placement. */
export const cardOpen = () => (placement() === "inline" ? inlineOpen() : popoverOpen())

/** True when the card sits beside the chat, so the chat column makes room for it. */
export const cardInline = () => placement() === "inline" && inlineOpen()

export function toggleCard() {
  if (placement() === "inline") {
    const next = !inlineOpen()
    setInlineOpen(next)
    writeInline(next)
  } else setPopoverOpen(!popoverOpen())
}

export const closeCard = () => setPopoverOpen(false)

/** Starts loading the card's chunk. Safe to call any number of times: the module loads once. */
export const loadCard = () => import("./Card")
