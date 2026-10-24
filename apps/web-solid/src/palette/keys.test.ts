import { describe, expect, it } from "vitest"
import { intentOf, type KeyContext, type KeyLike } from "./keys"

const key = (name: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: name,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...extra,
})

const base: KeyContext = {
  root: true,
  files: false,
  empty: true,
  peeking: false,
  picked: 0,
  inFolder: false,
  inView: false,
  hasActions: false,
  onFile: false,
  onFolder: false,
}

describe("palette keys", () => {
  it("steps tabs with Tab and Shift+Tab at the root, and never lets focus leave in a view", () => {
    expect(intentOf(key("Tab"), base)).toBe("next-tab")
    expect(intentOf(key("Tab", { shiftKey: true }), base)).toBe("previous-tab")
    expect(intentOf(key("Tab"), { ...base, root: false })).toBe("trap-tab")
  })

  it("lets Escape undo one thing at a time: the peek, then the selection, then the palette", () => {
    expect(intentOf(key("Escape"), { ...base, files: true, peeking: true, picked: 2 })).toBe("unpeek")
    expect(intentOf(key("Escape"), { ...base, files: true, picked: 2 })).toBe("clear-picks")
    expect(intentOf(key("Escape"), base)).toBe("close")
  })

  it("opens actions with Alt+Enter only on a row that has actions", () => {
    expect(intentOf(key("Enter", { altKey: true }), { ...base, hasActions: true })).toBe("actions")
    expect(intentOf(key("Enter", { altKey: true }), base)).toBeUndefined()
  })

  it("asks Kiko with Mod+Enter, or attaches once files are selected", () => {
    expect(intentOf(key("Enter", { metaKey: true }), base)).toBe("ask")
    expect(intentOf(key("Enter", { ctrlKey: true }), { ...base, files: true, picked: 3 })).toBe("attach")
  })

  it("walks folders with the arrow keys only while the field is empty", () => {
    const inFiles = { ...base, files: true, inFolder: true, onFolder: true }
    expect(intentOf(key("ArrowRight"), inFiles)).toBe("open-folder")
    expect(intentOf(key("ArrowLeft"), inFiles)).toBe("folder-up")
    expect(intentOf(key("ArrowRight"), { ...inFiles, empty: false })).toBeUndefined()
  })

  it("previews a file with the right arrow and closes the preview with the left arrow", () => {
    const onFile = { ...base, files: true, onFile: true }
    expect(intentOf(key("ArrowRight"), onFile)).toBe("toggle-peek")
    expect(intentOf(key("ArrowLeft"), { ...onFile, peeking: true })).toBe("unpeek")
  })

  it("selects with Space, selects everything with Mod+A, and extends with Shift+Arrow", () => {
    const onFile = { ...base, files: true, onFile: true }
    expect(intentOf(key(" "), onFile)).toBe("pick")
    expect(intentOf(key("a", { metaKey: true }), onFile)).toBe("pick-all")
    expect(intentOf(key("ArrowDown", { shiftKey: true }), onFile)).toBe("extend")
    expect(intentOf(key(" "), { ...onFile, empty: false })).toBeUndefined()
  })

  it("goes up a folder with Backspace before it leaves the view", () => {
    expect(intentOf(key("Backspace"), { ...base, files: true, inFolder: true, inView: true })).toBe("folder-up")
    expect(intentOf(key("Backspace"), { ...base, inView: true })).toBe("leave-view")
    expect(intentOf(key("Backspace"), { ...base, empty: false })).toBeUndefined()
  })
})
