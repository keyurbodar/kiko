import { dlopen, FFIType, ptr, read, toBuffer } from "bun:ffi"
import type { Native } from "./contract"
import { macKeyCode } from "../keymap"

const FRAMEWORKS = "/System/Library/Frameworks"

const EVENT = {
  leftDown: 1,
  leftUp: 2,
  rightDown: 3,
  rightUp: 4,
  mouseMoved: 5,
  otherDown: 25,
  otherUp: 26,
  scrollWheel: 22,
  keyDown: 10,
  keyUp: 11,
} as const

const SHIFT = 0x00020000
const CONTROL = 0x00040000
const ALTERNATE = 0x00080000
const COMMAND = 0x00100000
const HID = 0

const FLAGS: Record<string, number> = {
  ShiftLeft: SHIFT,
  ShiftRight: SHIFT,
  ControlLeft: CONTROL,
  ControlRight: CONTROL,
  AltLeft: ALTERNATE,
  AltRight: ALTERNATE,
  MetaLeft: COMMAND,
  MetaRight: COMMAND,
}

type Core = {
  mouse: (type: number, x: number, y: number, button: number, flags: number) => void
  scroll: (vertical: number, horizontal: number, flags: number) => void
  keyboard: (keycode: number, down: boolean, flags: number) => void
  unicode: (text: string, flags: number) => void
  cursor: () => { x: number; y: number } | null
}

function open(): Core | null {
  try {
    const cg = dlopen(`${FRAMEWORKS}/CoreGraphics.framework/CoreGraphics`, {
      CGEventCreateMouseEvent: {
        args: [FFIType.ptr, FFIType.u32, FFIType.f64, FFIType.f64, FFIType.u32],
        returns: "ptr",
      },
      CGEventCreateKeyboardEvent: { args: [FFIType.ptr, FFIType.u16, FFIType.bool], returns: "ptr" },
      CGEventCreateScrollWheelEvent: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.i32, FFIType.i32],
        returns: "ptr",
      },
      CGEventKeyboardSetUnicodeString: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: "void" },
      CGEventSetFlags: { args: [FFIType.ptr, FFIType.u64], returns: "void" },
      CGEventPost: { args: [FFIType.u32, FFIType.ptr], returns: "void" },
      CGEventGetLocation: { args: [FFIType.ptr], returns: "ptr" },
      CGEventSourceCreate: { args: [FFIType.u32], returns: "ptr" },
    })
    const cf = dlopen(`${FRAMEWORKS}/CoreFoundation.framework/CoreFoundation`, {
      CFRelease: { args: [FFIType.ptr], returns: "void" },
    })
    const source = cg.symbols.CGEventSourceCreate(HID)
    const emit = (event: never): void => {
      if (!event) return
      cg.symbols.CGEventPost(HID, event)
      cf.symbols.CFRelease(event)
    }
    return {
      mouse(type, x, y, button, flags) {
        const event = cg.symbols.CGEventCreateMouseEvent(null, type, x, y, button)
        if (!event) return
        if (flags) cg.symbols.CGEventSetFlags(event, flags)
        emit(event as never)
      },
      scroll(vertical, horizontal, flags) {
        const event = cg.symbols.CGEventCreateScrollWheelEvent(source, HID, 2, vertical, horizontal)
        if (!event) return
        if (flags) cg.symbols.CGEventSetFlags(event, flags)
        emit(event as never)
      },
      keyboard(keycode, down, flags) {
        const event = cg.symbols.CGEventCreateKeyboardEvent(source, keycode, down)
        if (!event) return
        if (flags) cg.symbols.CGEventSetFlags(event, flags)
        emit(event as never)
      },
      unicode(text, flags) {
        const units = new Uint16Array(text.length)
        for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i)
        const event = cg.symbols.CGEventCreateKeyboardEvent(source, 0, true)
        if (!event) return
        cg.symbols.CGEventKeyboardSetUnicodeString(event, units.length, ptr(units))
        if (flags) cg.symbols.CGEventSetFlags(event, flags)
        emit(event as never)
      },
      cursor() {
        const event = cg.symbols.CGEventCreateMouseEvent(source, EVENT.mouseMoved, 0, 0, 0)
        if (!event) return null
        try {
          const at = cg.symbols.CGEventGetLocation(event)
          if (!at) return null
          const buffer = toBuffer(at, 0, 16)
          return { x: read.f64(ptr(buffer), 0), y: read.f64(ptr(buffer), 8) }
        } finally {
          cf.symbols.CFRelease(event)
        }
      },
    }
  } catch {
    return null
  }
}

export function macNative(): Native | null {
  const core = open()
  if (!core) return null
  let flags = 0
  const held = new Set<string>()

  return {
    move(x, y) {
      core.mouse(EVENT.mouseMoved, x, y, 0, flags)
    },
    button(slot, down, x, y) {
      const type =
        slot === 1
          ? down
            ? EVENT.rightDown
            : EVENT.rightUp
          : slot === 2
            ? down
              ? EVENT.otherDown
              : EVENT.otherUp
            : down
              ? EVENT.leftDown
              : EVENT.leftUp
      core.mouse(type, x, y, slot, flags)
    },
    wheel(steps, horizontal) {
      core.scroll(horizontal ? 0 : -steps, horizontal ? -steps : 0, flags)
    },
    key(code, key, down) {
      if (down) held.add(code)
      else held.delete(code)
      const flag = FLAGS[code]
      if (flag) flags = down ? flags | flag : flags & ~flag
      const keycode = macKeyCode(code, key)
      if (keycode === 0xffff) return
      core.keyboard(keycode, down, flags)
    },
    text(value) {
      for (const char of value) core.unicode(char, flags)
    },
    cursor() {
      return core.cursor()
    },
    screen() {
      return null
    },
    release() {
      for (const code of held) {
        const keycode = macKeyCode(code, code)
        if (keycode !== 0xffff) core.keyboard(keycode, false, 0)
      }
      held.clear()
      flags = 0
    },
  }
}
