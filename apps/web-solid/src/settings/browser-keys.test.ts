import { describe, expect, test } from "bun:test"
import { parseBindings } from "../commands/bindings"
import { browserKey, refusal, sameKey } from "./browser-keys"

describe("keys the browser uses", () => {
  test("the tab and window keys are kept on every platform, whichever way the key is written", () => {
    expect(browserKey("Mod+N", "windows")).toEqual({ action: "New window", kept: true })
    expect(browserKey("Control+N", "windows")?.kept).toBe(true)
    expect(browserKey("Meta+T", "mac")?.kept).toBe(true)
    expect(browserKey("Shift+Mod+W", "mac")).toEqual({ action: "Close window", kept: true })
  })

  test("Mod+1 switches tabs, so it is shared, not kept, and Control+1 on a Mac is free", () => {
    expect(browserKey("Mod+1", "mac")).toEqual({ action: "Go to tab 1", kept: false })
    expect(browserKey("Control+1", "mac")).toBeUndefined()
    expect(browserKey("Alt+1", "windows")).toBeUndefined()
    expect(browserKey("Alt+1", "linux")?.action).toBe("Go to tab 1")
  })

  test("a system key belongs only to its own platform", () => {
    expect(browserKey("Meta+Q", "mac")?.kept).toBe(true)
    expect(browserKey("Meta+Q", "windows")).toBeUndefined()
    expect(browserKey("Alt+F4", "windows")?.kept).toBe(true)
  })

  test("Mod+K is Meta+K on a Mac and Control+K elsewhere", () => {
    expect(sameKey("Mod+K", "Meta+K", "mac")).toBe(true)
    expect(sameKey("Mod+K", "Control+K", "mac")).toBe(false)
    expect(sameKey("Mod+K", "Control+K", "windows")).toBe(true)
  })
})

describe("what the shortcut settings refuse", () => {
  test("a kept key, because kiko would never see it", () => {
    expect(refusal({ global: false }, "Mod+T", "windows")).toBe("Kiko never gets Ctrl+T. It always means New tab.")
    expect(refusal({ global: false }, "Mod+J", "windows")).toBeUndefined()
  })

  test("a bare key on a command that works while typing, which would eat the letter", () => {
    expect(refusal({ global: true }, "K", "mac")).toBeDefined()
    expect(refusal({ global: true }, "Shift+K", "mac")).toBeDefined()
    expect(refusal({ global: true }, "F2", "mac")).toBeUndefined()
    expect(refusal({ global: false }, "K", "mac")).toBeUndefined()
  })
})

describe("stored keys", () => {
  test("keep strings and nulls, and drop anything else", () => {
    expect(parseBindings('{"a":"Mod+J","b":null,"c":3,"d":""}')).toEqual({ a: "Mod+J", b: null })
    expect(parseBindings("not json")).toEqual({})
    expect(parseBindings("[1]")).toEqual({})
    expect(parseBindings(null)).toEqual({})
  })
})
