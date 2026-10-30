import { describe, expect, it } from "@effect/vitest"
import { Fail } from "../log"
import { parseKeys } from "./keys"

function keysOf(input: string) {
  return parseKeys(input).map((chord) => [chord.mods, chord.code, chord.key])
}

function fails(input: string) {
  try {
    parseKeys(input)
  } catch (error) {
    return error
  }
  throw new Error(`${input} did not fail`)
}

describe("parseKeys", () => {
  it("reads a single letter with a command modifier", () => {
    expect(keysOf("cmd+l")).toEqual([[["MetaLeft"], "KeyL", "l"]])
  })

  it("reads every modifier alias", () => {
    expect(parseKeys("command+a")[0]?.mods).toEqual(["MetaLeft"])
    expect(parseKeys("meta+a")[0]?.mods).toEqual(["MetaLeft"])
    expect(parseKeys("super+a")[0]?.mods).toEqual(["MetaLeft"])
    expect(parseKeys("win+a")[0]?.mods).toEqual(["MetaLeft"])
    expect(parseKeys("control+a")[0]?.mods).toEqual(["ControlLeft"])
    expect(parseKeys("option+a")[0]?.mods).toEqual(["AltLeft"])
    expect(parseKeys("opt+a")[0]?.mods).toEqual(["AltLeft"])
    expect(parseKeys("shift+a")[0]?.mods).toEqual(["ShiftLeft"])
  })

  it("keeps modifiers in the order they were written", () => {
    expect(keysOf("ctrl+shift+t")).toEqual([[["ControlLeft", "ShiftLeft"], "KeyT", "t"]])
    expect(keysOf("shift+ctrl+t")).toEqual([[["ShiftLeft", "ControlLeft"], "KeyT", "t"]])
  })

  it("ignores case", () => {
    expect(keysOf("CMD+SHIFT+L")).toEqual([[["MetaLeft", "ShiftLeft"], "KeyL", "l"]])
    expect(keysOf("Enter")).toEqual(keysOf("enter"))
  })

  it("maps letters and digits to their DOM codes", () => {
    expect(keysOf("a z")).toEqual([
      [[], "KeyA", "a"],
      [[], "KeyZ", "z"],
    ])
    expect(keysOf("0 9")).toEqual([
      [[], "Digit0", "0"],
      [[], "Digit9", "9"],
    ])
  })

  it("maps punctuation to its DOM codes", () => {
    expect(keysOf("- = [ ] \\ ; ' ` , . /")).toEqual([
      [[], "Minus", "-"],
      [[], "Equal", "="],
      [[], "BracketLeft", "["],
      [[], "BracketRight", "]"],
      [[], "Backslash", "\\"],
      [[], "Semicolon", ";"],
      [[], "Quote", "'"],
      [[], "Backquote", "`"],
      [[], "Comma", ","],
      [[], "Period", "."],
      [[], "Slash", "/"],
    ])
  })

  it("maps named keys", () => {
    expect(keysOf("enter return esc escape tab space backspace delete del")).toEqual([
      [[], "Enter", "Enter"],
      [[], "Enter", "Enter"],
      [[], "Escape", "Escape"],
      [[], "Escape", "Escape"],
      [[], "Tab", "Tab"],
      [[], "Space", " "],
      [[], "Backspace", "Backspace"],
      [[], "Delete", "Delete"],
      [[], "Delete", "Delete"],
    ])
  })

  it("maps arrows by short and long name", () => {
    expect(keysOf("up down left right")).toEqual(keysOf("arrowup arrowdown arrowleft arrowright"))
    expect(keysOf("up down left right")).toEqual([
      [[], "ArrowUp", "ArrowUp"],
      [[], "ArrowDown", "ArrowDown"],
      [[], "ArrowLeft", "ArrowLeft"],
      [[], "ArrowRight", "ArrowRight"],
    ])
  })

  it("maps navigation keys", () => {
    expect(keysOf("home end pageup pagedown insert")).toEqual([
      [[], "Home", "Home"],
      [[], "End", "End"],
      [[], "PageUp", "PageUp"],
      [[], "PageDown", "PageDown"],
      [[], "Insert", "Insert"],
    ])
  })

  it("maps function keys up to f24", () => {
    expect(keysOf("f1 f12 f24")).toEqual([
      [[], "F1", "F1"],
      [[], "F12", "F12"],
      [[], "F24", "F24"],
    ])
    expect(() => parseKeys("f25")).toThrow(Fail)
  })

  it("reads plus as shift and equal", () => {
    expect(keysOf("plus")).toEqual([[["ShiftLeft"], "Equal", "+"]])
    expect(keysOf("cmd+plus")).toEqual([[["MetaLeft", "ShiftLeft"], "Equal", "+"]])
    expect(keysOf("shift+plus")).toEqual([[["ShiftLeft"], "Equal", "+"]])
  })

  it("reads several chords in one string", () => {
    expect(keysOf("cmd+l cmd+c enter")).toEqual([
      [["MetaLeft"], "KeyL", "l"],
      [["MetaLeft"], "KeyC", "c"],
      [[], "Enter", "Enter"],
    ])
  })

  it("ignores extra spaces around a chord", () => {
    expect(keysOf("  ctrl+shift+t  ")).toEqual([[["ControlLeft", "ShiftLeft"], "KeyT", "t"]])
  })

  it("names an unknown key and how to write one", () => {
    const error = fails("cmd+launch")
    expect(error).toBeInstanceOf(Fail)
    expect((error as Fail).code).toBe("failed")
    expect((error as Fail).message).toBe("unknown key launch; use names like cmd+l, ctrl+shift+t, enter, pagedown")
  })

  it("fails on an unknown modifier and on empty input", () => {
    expect(fails("hyper+a")).toBeInstanceOf(Fail)
    expect(fails("")).toBeInstanceOf(Fail)
  })
})
