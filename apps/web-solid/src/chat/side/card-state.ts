import { createSignal } from "solid-js"

/*
 * The chat card. Beside a wide chat it is open unless the human closed it, and that choice is
 * saved. Over a narrow chat it would cover messages, so there it opens only on request.
 */
const KEY = "kiko:card"

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0"
  } catch {
    return true
  }
}

const [docked, setDocked] = createSignal(read())
const [popped, setPopped] = createSignal(false)
const [wide, setWide] = createSignal(true)

/** The chat panel's width decides whether the card sits beside the chat or over it. */
export const setCardRoom = (width: number) => setWide(width >= CARD_ROOM)

/** Room for the chat lane and the card side by side. */
export const CARD_ROOM = 1040
export const CARD_WIDTH = 288

export const cardShown = () => (wide() ? docked() : popped())
export const cardBeside = () => wide() && docked()

/** A card over the chat closes when the reader moves on. A docked card is the reader's saved choice and stays. */
export const dismissCard = () => setPopped(false)

export function toggleCard() {
  if (!wide()) return setPopped(!popped())
  const next = !docked()
  setDocked(next)
  try {
    localStorage.setItem(KEY, next ? "1" : "0")
  } catch {}
}

export const loadCard = () => import("./card")
