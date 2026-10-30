import { dlopen, FFIType, ptr } from "bun:ffi"
import type { Native } from "./contract"
import { macKeyCode } from "../keymap"

const FRAMEWORKS = "/System/Library/Frameworks"
const HITOOLBOX = `${FRAMEWORKS}/Carbon.framework/Frameworks/HIToolbox.framework/HIToolbox`
const GLOBAL_POINTS = 1
const CLICK_STATE = 1
const DOUBLE_CLICK_MS = 500
const DOUBLE_CLICK_PX = 4

const EVENT = {
  leftDown: 1,
  leftUp: 2,
  rightDown: 3,
  rightUp: 4,
  mouseMoved: 5,
  leftDragged: 6,
  rightDragged: 7,
  otherDragged: 27,
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
  mouse: (type: number, x: number, y: number, button: number, flags: number, clicks: number) => void
  scroll: (vertical: number, horizontal: number, flags: number) => void
  keyboard: (keycode: number, down: boolean, flags: number) => void
  unicode: (text: string, flags: number) => void
  cursor: () => { x: number; y: number } | null
  display: () => { width: number; height: number } | null
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
      CGEventSetIntegerValueField: { args: [FFIType.ptr, FFIType.u32, FFIType.i64], returns: "void" },
      CGEventPost: { args: [FFIType.u32, FFIType.ptr], returns: "void" },
      CGEventSourceCreate: { args: [FFIType.u32], returns: "ptr" },
      CGMainDisplayID: { args: [], returns: FFIType.u32 },
      CGDisplayPixelsWide: { args: [FFIType.u32], returns: FFIType.u64 },
      CGDisplayPixelsHigh: { args: [FFIType.u32], returns: FFIType.u64 },
    })
    const cf = dlopen(`${FRAMEWORKS}/CoreFoundation.framework/CoreFoundation`, {
      CFRelease: { args: [FFIType.ptr], returns: "void" },
    })
    const source = cg.symbols.CGEventSourceCreate(HID)
    const scroll2 = optional(`${FRAMEWORKS}/CoreGraphics.framework/CoreGraphics`, {
      CGEventCreateScrollWheelEvent2: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.i32],
        returns: "ptr",
      },
    })
    const mouseAt = optional(HITOOLBOX, {
      HIGetMousePosition: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    })
    const point = new Float64Array(2)
    const emit = (event: never): void => {
      if (!event) return
      cg.symbols.CGEventPost(HID, event)
      cf.symbols.CFRelease(event)
    }
    return {
      mouse(type, x, y, button, flags, clicks) {
        const event = cg.symbols.CGEventCreateMouseEvent(null, type, x, y, button)
        if (!event) return
        if (flags) cg.symbols.CGEventSetFlags(event, flags)
        if (clicks > 1) cg.symbols.CGEventSetIntegerValueField(event, CLICK_STATE, clicks)
        emit(event as never)
      },
      scroll(vertical, horizontal, flags) {
        const event = scroll2
          ? scroll2.CGEventCreateScrollWheelEvent2(source, HID, 2, vertical, horizontal, 0)
          : horizontal === 0
            ? cg.symbols.CGEventCreateScrollWheelEvent(source, HID, 1, vertical, 0)
            : null
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
        if (!mouseAt || mouseAt.HIGetMousePosition(GLOBAL_POINTS, null, ptr(point)) !== 0) return null
        return { x: point[0] ?? 0, y: point[1] ?? 0 }
      },
      display() {
        const id = cg.symbols.CGMainDisplayID()
        const width = Number(cg.symbols.CGDisplayPixelsWide(id))
        const height = Number(cg.symbols.CGDisplayPixelsHigh(id))
        if (width <= 0 || height <= 0) return null
        return { width, height }
      },
    }
  } catch {
    return null
  }
}

function optional<T extends Record<string, { args: FFIType[]; returns: FFIType | string }>>(
  path: string,
  symbols: T,
): Record<keyof T, (...args: unknown[]) => never> | null {
  try {
    return dlopen(path, symbols as never).symbols as never
  } catch {
    return null
  }
}

const DRAGGED = [EVENT.leftDragged, EVENT.rightDragged, EVENT.otherDragged] as const

function buttonEvent(slot: number, down: boolean): number {
  if (slot === 1) return down ? EVENT.rightDown : EVENT.rightUp
  if (slot === 2) return down ? EVENT.otherDown : EVENT.otherUp
  return down ? EVENT.leftDown : EVENT.leftUp
}

export function macNative(): Native | null {
  const core = open()
  if (!core) return null
  let flags = 0
  let pressed: number | null = null
  let pointer: { x: number; y: number } | null = null
  let last = { at: 0, x: 0, y: 0, slot: -1, clicks: 0 }
  const held = new Set<string>()

  const clicksFor = (slot: number, x: number, y: number): number => {
    const now = Date.now()
    const near = Math.abs(x - last.x) <= DOUBLE_CLICK_PX && Math.abs(y - last.y) <= DOUBLE_CLICK_PX
    const clicks = slot === last.slot && near && now - last.at <= DOUBLE_CLICK_MS ? last.clicks + 1 : 1
    last = { at: now, x, y, slot, clicks }
    return clicks
  }

  return {
    move(x, y) {
      pointer = { x, y }
      const dragged = pressed === null ? undefined : DRAGGED[pressed]
      core.mouse(dragged ?? EVENT.mouseMoved, x, y, pressed ?? 0, flags, 0)
    },
    button(slot, down, x, y) {
      pointer = { x, y }
      const clicks = down ? clicksFor(slot, x, y) : last.clicks
      pressed = down ? slot : null
      core.mouse(buttonEvent(slot, down), x, y, slot, flags, clicks)
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
      return core.display()
    },
    release() {
      if (pressed !== null) {
        const at = core.cursor() ?? pointer
        if (at) core.mouse(buttonEvent(pressed, false), at.x, at.y, pressed, flags, 1)
      }
      for (const code of held) {
        const keycode = macKeyCode(code, code)
        if (keycode !== 0xffff) core.keyboard(keycode, false, 0)
      }
      held.clear()
      flags = 0
      pressed = null
    },
  }
}
