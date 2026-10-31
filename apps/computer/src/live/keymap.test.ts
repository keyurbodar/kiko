import { describe, expect, it } from "@effect/vitest"
import { EXTENDED, SCAN } from "./keymap"

const EXTENDED_MAKE = {
  NumpadEnter: 0x1c,
  ControlRight: 0x1d,
  NumpadDivide: 0x35,
  PrintScreen: 0x37,
  AltRight: 0x38,
  NumLock: 0x45,
  Home: 0x47,
  ArrowUp: 0x48,
  PageUp: 0x49,
  ArrowLeft: 0x4b,
  ArrowRight: 0x4d,
  End: 0x4f,
  ArrowDown: 0x50,
  PageDown: 0x51,
  Insert: 0x52,
  Delete: 0x53,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  ContextMenu: 0x5d,
} as const

describe("windows scan codes", () => {
  it("stores set-1 make codes for the keys behind the prefix byte", () => {
    for (const [code, make] of Object.entries(EXTENDED_MAKE)) expect(SCAN.get(code), code).toBe(make)
  })

  it("never stores a break code in the scan table", () => {
    for (const [code, scan] of SCAN) expect(scan, code).toBeLessThan(0x80)
  })

  it("marks every prefixed key as extended", () => {
    for (const code of Object.keys(EXTENDED_MAKE)) expect(EXTENDED.has(code), code).toBe(true)
  })

  it("leaves the keys without a prefix alone", () => {
    for (const code of ["KeyA", "Enter", "ShiftLeft", "Numpad1", "F5"]) expect(EXTENDED.has(code), code).toBe(false)
  })
})
