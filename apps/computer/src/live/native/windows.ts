import { dlopen, FFIType } from "bun:ffi"
import type { Native } from "./contract"
import { SCAN, windowsVirtualKey } from "../keymap"

const INPUT_MOUSE = 0
const INPUT_KEYBOARD = 1
const KEYEVENTF_EXTENDEDKEY = 0x0001
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
const KEYEVENTF_SCANCODE = 0x0008
const MOUSEEVENTF_MOVE = 0x0001
const MOUSEEVENTF_ABSOLUTE = 0x8000
const MOUSEEVENTF_VIRTUALDESK = 0x4000
const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004
const MOUSEEVENTF_RIGHTDOWN = 0x0008
const MOUSEEVENTF_RIGHTUP = 0x0010
const MOUSEEVENTF_MIDDLEDOWN = 0x0020
const MOUSEEVENTF_MIDDLEUP = 0x0040
const MOUSEEVENTF_WHEEL = 0x0800
const MOUSEEVENTF_HWHEEL = 0x01000
const WHEEL_DELTA = 120
const WHEEL_PIXELS = 100
const UNIT = 0xffff
const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79
const INPUT_SIZE = 40
const UNION = 8
const PER_MONITOR_AWARE_V2 = -4
const EXTENDED = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "NumpadDivide",
  "NumpadEnter",
  "NumLock",
  "PrintScreen",
  "ControlRight",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "ContextMenu",
])

type User32 = {
  GetSystemMetrics: (index: number) => number
  SetCursorPos: (x: number, y: number) => boolean
  GetCursorPos: (point: Uint8Array) => boolean
  SendInput: (count: number, inputs: Uint8Array, size: number) => number
  SetProcessDpiAwarenessContext: (context: number) => boolean
}

function open(): User32 | null {
  try {
    const user32 = dlopen("user32.dll", {
      GetSystemMetrics: { args: [FFIType.i32], returns: "i32" },
      SetCursorPos: { args: [FFIType.i32, FFIType.i32], returns: "bool" },
      GetCursorPos: { args: [FFIType.ptr], returns: "bool" },
      SendInput: { args: [FFIType.u32, FFIType.ptr, FFIType.i32], returns: "u32" },
      SetProcessDpiAwarenessContext: { args: [FFIType.i64], returns: "bool" },
    })
    return user32.symbols as unknown as User32
  } catch {
    return null
  }
}

function slot(buffer: Uint8Array, type: number): DataView {
  buffer.fill(0, 0, INPUT_SIZE)
  const view = new DataView(buffer.buffer, buffer.byteOffset, INPUT_SIZE)
  view.setUint32(0, type, true)
  return view
}

function mouseInput(buffer: Uint8Array, flags: number, dx: number, dy: number, data: number): void {
  const view = slot(buffer, INPUT_MOUSE)
  view.setInt32(UNION, dx, true)
  view.setInt32(UNION + 4, dy, true)
  view.setInt32(UNION + 8, data, true)
  view.setUint32(UNION + 12, flags, true)
}

function keyInput(buffer: Uint8Array, flags: number, virtualKey: number, scan: number): void {
  const view = slot(buffer, INPUT_KEYBOARD)
  view.setUint16(UNION, virtualKey, true)
  view.setUint16(UNION + 2, scan, true)
  view.setUint32(UNION + 4, flags, true)
}

export function windowsNative(): Native | null {
  const user32 = open()
  if (!user32) return null
  try {
    user32.SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)
  } catch {}
  const point = new Uint8Array(8)
  const input = new Uint8Array(INPUT_SIZE * 2)
  const held = new Set<string>()

  const screen = (): { x: number; y: number; width: number; height: number } => ({
    x: user32.GetSystemMetrics(SM_XVIRTUALSCREEN),
    y: user32.GetSystemMetrics(SM_YVIRTUALSCREEN),
    width: user32.GetSystemMetrics(SM_CXVIRTUALSCREEN),
    height: user32.GetSystemMetrics(SM_CYVIRTUALSCREEN),
  })

  const absolute = (x: number, y: number): { dx: number; dy: number } => {
    const area = screen()
    return {
      dx: Math.round(((x - area.x) / Math.max(1, area.width - 1)) * UNIT),
      dy: Math.round(((y - area.y) / Math.max(1, area.height - 1)) * UNIT),
    }
  }

  const send = (count: number): void => {
    user32.SendInput(count, input, INPUT_SIZE)
  }

  const buttonFlag = (slot: number, down: boolean): number => {
    if (slot === 1) return down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP
    if (slot === 2) return down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP
    return down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP
  }

  return {
    move(x, y) {
      user32.SetCursorPos(x, y)
    },
    button(slot, down, x, y) {
      user32.SetCursorPos(x, y)
      const at = absolute(x, y)
      mouseInput(
        input,
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | buttonFlag(slot, down),
        at.dx,
        at.dy,
        0,
      )
      send(1)
    },
    wheel(pixels, horizontal) {
      const data = Math.round((pixels * WHEEL_DELTA) / WHEEL_PIXELS)
      if (data === 0) return
      mouseInput(input, horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, 0, 0, horizontal ? data : -data)
      send(1)
    },
    key(code, key, down) {
      if (down) held.add(code)
      else held.delete(code)
      const scan = SCAN.get(code) ?? 0
      const flags =
        (down ? 0 : KEYEVENTF_KEYUP) |
        (scan ? KEYEVENTF_SCANCODE : 0) |
        (EXTENDED.has(code) ? KEYEVENTF_EXTENDEDKEY : 0)
      const virtualKey = windowsVirtualKey(code, key)
      keyInput(input, flags, virtualKey, scan)
      send(1)
    },
    text(value) {
      for (const char of value) {
        const code = char.codePointAt(0) ?? 0
        const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code]
        for (const up of [false, true]) {
          units.forEach((unit, index) =>
            keyInput(input.subarray(index * INPUT_SIZE), KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0), 0, unit),
          )
          send(units.length)
        }
      }
    },
    cursor() {
      if (!user32.GetCursorPos(point as never)) return null
      const view = new DataView(point.buffer)
      return { x: view.getInt32(0, true), y: view.getInt32(4, true) }
    },
    screen() {
      const area = screen()
      return { width: area.width, height: area.height }
    },
    release() {
      for (const code of held) {
        const scan = SCAN.get(code) ?? 0
        const virtualKey = windowsVirtualKey(code, code)
        keyInput(
          input,
          KEYEVENTF_KEYUP | (scan ? KEYEVENTF_SCANCODE : 0) | (EXTENDED.has(code) ? KEYEVENTF_EXTENDEDKEY : 0),
          virtualKey,
          scan,
        )
        send(1)
      }
      held.clear()
      for (const slot of [0, 1, 2]) {
        mouseInput(input, buttonFlag(slot, false), 0, 0, 0)
        send(1)
      }
    },
  }
}
