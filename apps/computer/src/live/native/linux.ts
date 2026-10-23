import { dlopen, FFIType, ptr } from "bun:ffi"
import type { Native } from "./contract"

const NAMED = new Map<string, number>([
  ["Escape", 0xff1b],
  ["Backspace", 0xff08],
  ["Tab", 0xff09],
  ["Enter", 0xff0d],
  ["NumpadEnter", 0xff8d],
  ["Space", 0x0020],
  ["CapsLock", 0xffe5],
  ["PageUp", 0xff55],
  ["PageDown", 0xff56],
  ["End", 0xff57],
  ["Home", 0xff50],
  ["ArrowLeft", 0xff51],
  ["ArrowUp", 0xff52],
  ["ArrowRight", 0xff53],
  ["ArrowDown", 0xff54],
  ["PrintScreen", 0xff61],
  ["Insert", 0xff63],
  ["Delete", 0xffff],
  ["ShiftLeft", 0xffe1],
  ["ShiftRight", 0xffe2],
  ["ControlLeft", 0xffe3],
  ["ControlRight", 0xffe4],
  ["AltLeft", 0xffe9],
  ["AltRight", 0xffea],
  ["MetaLeft", 0xffeb],
  ["MetaRight", 0xffec],
  ["ContextMenu", 0xff67],
  ["NumLock", 0xff7f],
  ["ScrollLock", 0xff14],
  ["Pause", 0xff13],
  ["Minus", 0x002d],
  ["Equal", 0x003d],
  ["BracketLeft", 0x005b],
  ["BracketRight", 0x005d],
  ["Backslash", 0x005c],
  ["Semicolon", 0x003b],
  ["Quote", 0x0027],
  ["Backquote", 0x0060],
  ["Comma", 0x002c],
  ["Period", 0x002e],
  ["Slash", 0x002f],
  ["NumpadAdd", 0xffab],
  ["NumpadSubtract", 0xffad],
  ["NumpadMultiply", 0xffaa],
  ["NumpadDivide", 0xffaf],
  ["NumpadDecimal", 0xffae],
  ["NumpadEqual", 0xffbd],
  ["F1", 0xffbe],
  ["F2", 0xffbf],
  ["F3", 0xffc0],
  ["F4", 0xffc1],
  ["F5", 0xffc2],
  ["F6", 0xffc3],
  ["F7", 0xffc4],
  ["F8", 0xffc5],
  ["F9", 0xffc6],
  ["F10", 0xffc7],
  ["F11", 0xffc8],
  ["F12", 0xffc9],
  ...Array.from({ length: 10 }, (_, digit) => [`Numpad${digit}`, 0xffb0 + digit] as const),
])

const SHIFTED = new Map<string, string>([
  ["!", "1"],
  ["@", "2"],
  ["#", "3"],
  ["$", "4"],
  ["%", "5"],
  ["^", "6"],
  ["&", "7"],
  ["*", "8"],
  ["(", "9"],
  [")", "0"],
  ["_", "-"],
  ["+", "="],
  ["{", "["],
  ["}", "]"],
  ["|", "\\"],
  [":", ";"],
  ['"', "'"],
  ["~", "`"],
  ["<", ","],
  [">", "."],
  ["?", "/"],
])

type Symbols = {
  display: number
  width: number
  height: number
  keysym: (code: string, key: string) => number
  keycode: (symbol: number) => number
  motion: (x: number, y: number) => void
  button: (button: number, down: boolean) => void
  keycodeDown: (keycode: number, down: boolean) => void
  flush: () => void
  query: () => { x: number; y: number } | null
}

function openSymbols(): Symbols | null {
  try {
    const xtst = dlopen("libXtst.so.6", {
      XTestFakeMotionEvent: { args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u64], returns: "i32" },
      XTestFakeButtonEvent: { args: [FFIType.ptr, FFIType.u32, FFIType.bool, FFIType.u64], returns: "i32" },
      XTestFakeKeyEvent: { args: [FFIType.ptr, FFIType.u32, FFIType.bool, FFIType.u64], returns: "i32" },
    })
    const x11 = dlopen("libX11.so.6", {
      XOpenDisplay: { args: [FFIType.cstring], returns: "ptr" },
      XFlush: { args: [FFIType.ptr], returns: "void" },
      XDefaultRootWindow: { args: [FFIType.ptr], returns: "u64" },
      XDisplayWidth: { args: [FFIType.ptr, FFIType.i32], returns: "i32" },
      XDisplayHeight: { args: [FFIType.ptr, FFIType.i32], returns: "i32" },
      XQueryPointer: {
        args: [
          FFIType.ptr,
          FFIType.u64,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
        ],
        returns: "bool",
      },
      XKeysymToKeycode: { args: [FFIType.ptr, FFIType.u64], returns: "u8" },
    })
    const display = x11.symbols.XOpenDisplay(null)
    if (!display) return null
    const root = x11.symbols.XDefaultRootWindow(display)
    const scratch = new BigUint64Array(2)
    const coords = new Int32Array(4)
    const mask = new Int32Array(1)
    return {
      display,
      width: x11.symbols.XDisplayWidth(display, 0),
      height: x11.symbols.XDisplayHeight(display, 0),
      keysym: (code, key) => keysymOf(code, key),
      keycode: (symbol) => x11.symbols.XKeysymToKeycode(display, BigInt(symbol)),
      motion: (x, y) => {
        xtst.symbols.XTestFakeMotionEvent(display, -1, x, y, 0n)
      },
      button: (button, down) => {
        xtst.symbols.XTestFakeButtonEvent(display, button, down, 0n)
      },
      keycodeDown: (code, down) => {
        xtst.symbols.XTestFakeKeyEvent(display, code, down, 0n)
      },
      flush: () => x11.symbols.XFlush(display),
      query: () => {
        const ok = x11.symbols.XQueryPointer(
          display,
          root,
          ptr(scratch),
          ptr(scratch, 8),
          ptr(coords),
          ptr(coords, 4),
          ptr(coords, 8),
          ptr(coords, 12),
          ptr(mask),
        )
        return ok ? { x: coords[0]!, y: coords[1]! } : null
      },
    }
  } catch {
    return null
  }
}

function baseOf(key: string): string {
  const shifted = SHIFTED.get(key)
  if (shifted) return shifted
  if (key.length === 1 && key >= "A" && key <= "Z") return key.toLowerCase()
  return key
}

function keysymOf(code: string, key: string): number {
  const named = NAMED.get(code)
  if (named !== undefined) return named
  if (key.length !== 1) return 0
  return baseOf(key).charCodeAt(0)
}

function needsShift(key: string): boolean {
  return (key.length === 1 && key >= "A" && key <= "Z") || SHIFTED.has(key)
}

export function linuxNative(): Native | null {
  const symbols = openSymbols()
  if (!symbols) return null
  const down = new Set<string>()

  const type = (char: string): void => {
    if (char === "\n" || char === "\r") {
      const code = symbols.keycode(0xff0d)
      symbols.keycodeDown(code, true)
      symbols.keycodeDown(code, false)
      return
    }
    if (char === "\t") {
      const code = symbols.keycode(0xff09)
      symbols.keycodeDown(code, true)
      symbols.keycodeDown(code, false)
      return
    }
    const shift = needsShift(char)
    const code = symbols.keycode(baseOf(char).charCodeAt(0))
    if (!code) return
    if (shift) symbols.keycodeDown(symbols.keycode(0xffe1), true)
    symbols.keycodeDown(code, true)
    symbols.keycodeDown(code, false)
    if (shift) symbols.keycodeDown(symbols.keycode(0xffe1), false)
  }

  return {
    move(x, y) {
      symbols.motion(x, y)
      symbols.flush()
    },
    button(slot, isDown, x, y) {
      symbols.motion(x, y)
      symbols.button(slot + 1, isDown)
      symbols.flush()
    },
    wheel(steps, horizontal) {
      const button = horizontal ? (steps > 0 ? 6 : 7) : steps > 0 ? 4 : 5
      const count = Math.min(10, Math.max(1, Math.abs(steps)))
      for (let i = 0; i < count; i++) symbols.button(button, true)
      for (let i = 0; i < count; i++) symbols.button(button, false)
      symbols.flush()
    },
    key(code, key, isDown) {
      const keycode = symbols.keycode(symbols.keysym(code, key))
      if (!keycode) return
      if (isDown) down.add(code)
      else down.delete(code)
      symbols.keycodeDown(keycode, isDown)
      symbols.flush()
    },
    text(value) {
      for (const char of value) type(char)
      symbols.flush()
    },
    cursor() {
      return symbols.query()
    },
    screen() {
      return { width: symbols.width, height: symbols.height }
    },
    release() {
      for (const code of down) {
        const keycode = symbols.keycode(symbols.keysym(code, code))
        if (keycode) symbols.keycodeDown(keycode, false)
      }
      down.clear()
      symbols.flush()
    },
  }
}
