import { createSignal } from "solid-js"

const KEY = "kiko:device:card"

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

const CARD_ROOM = 1040

export const setCardRoom = (width: number) => setWide(width >= CARD_ROOM)

export const CARD_WIDTH = 288

export const cardShown = () => (wide() ? docked() : popped())
export const cardBeside = () => wide() && docked()

export const dismissCard = () => setPopped(false)

export function toggleCard() {
  if (!wide()) return setPopped(!popped())
  const next = !docked()
  setDocked(next)
  try {
    localStorage.setItem(KEY, next ? "1" : "0")
  } catch {}
}
