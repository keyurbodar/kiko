import type { InputEvent } from "@kiko/computer/wire"

export type Viewport = { width: number; height: number }

export type InputState = { buttons: Set<number>; point: { x: number; y: number } }

export type Send = (message: Record<string, unknown>) => void

const BUTTONS = ["left", "middle", "right"] as const

const VIRTUAL: Readonly<Record<string, number>> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Insert: 45,
  Space: 32,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  MetaLeft: 91,
  MetaRight: 92,
  Backquote: 192,
  Minus: 189,
  Equal: 187,
  BracketLeft: 219,
  BracketRight: 221,
  Backslash: 220,
  Semicolon: 186,
  Quote: 222,
  Comma: 188,
  Period: 190,
  Slash: 191,
  CapsLock: 20,
  NumpadEnter: 13,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadMultiply: 106,
  NumpadDivide: 111,
  NumpadDecimal: 110,
}

const TEXT: Readonly<Record<string, string>> = { Enter: "\r", Tab: "\t" }
const CHORD = 2 | 4 | 8

function typed(event: Extract<InputEvent, { k: "key" }>): string | undefined {
  if (!event.down) return undefined
  const fixed = TEXT[event.key]
  if (fixed !== undefined) return fixed
  if (event.mods & CHORD) return undefined
  return event.key.length === 1 ? event.key : undefined
}

export function createInputState(): InputState {
  return { buttons: new Set(), point: { x: 0, y: 0 } }
}

function virtualKey(code: string, key: string): number {
  if (code.startsWith("Key")) return code.charCodeAt(3)
  if (code.startsWith("Digit")) return code.charCodeAt(5)
  if (/^Numpad\d$/.test(code)) return code.charCodeAt(6)
  if (code.startsWith("F") && /^\d+$/.test(code.slice(1))) return 111 + Number(code.slice(1))
  const known = VIRTUAL[code]
  if (known !== undefined) return known
  return key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
}

export function modifiers(mods: number): number {
  return (mods & 4 ? 1 : 0) | (mods & 2 ? 2 : 0) | (mods & 8 ? 4 : 0) | (mods & 1 ? 8 : 0)
}

function at(state: InputState, viewport: Viewport, x: number, y: number): { x: number; y: number } {
  state.point = { x: x * viewport.width, y: y * viewport.height }
  return state.point
}

export function applyInput(events: readonly InputEvent[], viewport: Viewport, state: InputState, send: Send): void {
  for (const event of events) {
    if (event.k === "move") {
      const point = at(state, viewport, event.x, event.y)
      send({ type: "input_mouse", eventType: "mouseMoved", x: point.x, y: point.y, button: "none" })
      continue
    }
    if (event.k === "down" || event.k === "up") {
      const point = at(state, viewport, event.x, event.y)
      const button = BUTTONS[event.b] ?? "left"
      if (event.k === "down") state.buttons.add(event.b)
      else state.buttons.delete(event.b)
      send({
        type: "input_mouse",
        eventType: event.k === "down" ? "mousePressed" : "mouseReleased",
        x: point.x,
        y: point.y,
        button,
        clickCount: 1,
      })
      continue
    }
    if (event.k === "wheel") {
      const point = at(state, viewport, event.x, event.y)
      send({
        type: "input_mouse",
        eventType: "mouseWheel",
        x: point.x,
        y: point.y,
        button: "none",
        deltaX: event.dx,
        deltaY: event.dy,
      })
      continue
    }
    if (event.k === "key") {
      const text = typed(event)
      send({
        type: "input_keyboard",
        eventType: event.down ? "keyDown" : "keyUp",
        key: event.key,
        code: event.code,
        windowsVirtualKeyCode: virtualKey(event.code, event.key),
        modifiers: modifiers(event.mods),
        ...(text === undefined ? {} : { text }),
      })
      continue
    }
    if (event.k === "text") {
      if (event.s) send({ type: "input_keyboard", eventType: "char", text: event.s })
      continue
    }
    if (event.k === "paste") {
      if (event.s) send({ type: "input_keyboard", eventType: "char", text: event.s })
    }
  }
}
