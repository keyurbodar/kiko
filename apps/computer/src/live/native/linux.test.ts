import { describe, expect, it } from "@effect/vitest"
import { vi } from "vitest"
import { nativeFrom, type Symbols } from "./linux"

vi.mock("bun:ffi", () => ({
  dlopen: () => ({ symbols: {} }),
  FFIType: {},
  ptr: () => 0,
  toArrayBuffer: () => new ArrayBuffer(0),
}))

const MIN = 10
const MAX = 14
const PER = 2

type Harness = {
  native: ReturnType<typeof nativeFrom>
  presses: number[]
  changes: { keycode: number; keysyms: number[] }[]
  settles: () => number
}

function harness(mapped: Map<number, number>, occupied = false): Harness {
  const presses: number[] = []
  const changes: { keycode: number; keysyms: number[] }[] = []
  const syms = new Float64Array((MAX - MIN + 1) * PER)
  if (occupied) syms.fill(1)
  let settles = 0
  const symbols: Symbols = {
    display: 0,
    width: 0,
    height: 0,
    keysym: () => 0,
    keycode: (symbol) => mapped.get(symbol) ?? 0,
    motion: () => {},
    button: () => {},
    keycodeDown: (code, down) => {
      if (down) presses.push(code)
    },
    flush: () => {},
    query: () => null,
    keyboard: () => ({ min: MIN, max: MAX, perKeycode: PER, syms }),
    change: (keycode, keysyms) => {
      changes.push({ keycode, keysyms: Array.from(keysyms, Number) })
    },
    sync: () => {},
  }
  const native = nativeFrom(symbols, () => {
    settles++
  })
  return { native, presses, changes, settles: () => settles }
}

describe("linux text injection", () => {
  it("types ascii without remapping or settling", () => {
    const h = harness(
      new Map([
        [0x61, 38],
        [0x62, 56],
      ]),
    )
    h.native.text("ab")
    expect(h.presses).toEqual([38, 56])
    expect(h.changes).toEqual([])
    expect(h.settles()).toBe(0)
  })

  it("settles once for a whole string of symbols", () => {
    const h = harness(new Map([[0x61, 38]]))
    h.native.text("aéü")
    expect(h.presses).toEqual([38, 14, 13])
    expect(h.settles()).toBe(1)
    expect(h.changes.map((change) => change.keycode)).toEqual([14, 13, 14, 13])
    expect(h.changes[0]!.keysyms[0]).toBe(0xe9)
    expect(h.changes[1]!.keysyms[0]).toBe(0xfc)
    expect(h.changes[2]!.keysyms.every((value) => value === 0)).toBe(true)
    expect(h.changes[3]!.keysyms.every((value) => value === 0)).toBe(true)
  })

  it("presses symbols the layout already maps without remapping", () => {
    const h = harness(new Map([[0xe9, 40]]))
    h.native.text("é")
    expect(h.presses).toEqual([40])
    expect(h.changes).toEqual([])
    expect(h.settles()).toBe(0)
  })

  it("keeps order and splits into rounds when spares run out", () => {
    const h = harness(new Map())
    h.native.text("éüñçåè")
    expect(h.presses).toEqual([14, 13, 12, 11, 10, 14])
    expect(h.settles()).toBe(2)
  })

  it("drops symbols when no spare keycode is free", () => {
    const h = harness(new Map([[0x61, 38]]), true)
    h.native.text("aé")
    expect(h.presses).toEqual([38])
    expect(h.changes).toEqual([])
    expect(h.settles()).toBe(0)
  })
})
