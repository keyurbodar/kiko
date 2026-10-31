import { describe, expect, it } from "vitest"
import { cuaWindows, desktopWindow, findCuaToken, findCuaWindow } from "./parse"

const MACOS_LIST = `Found 2 window(s).
- TextEdit (pid 844) "fixture.txt" [window_id: 10725]
- Finder (pid 501) "kiko-bench " [window_id: 999]`

const LINUX_LIST = `Found 1 windows:
  window_id=42 pid=123 "fixture.txt" 300x400+10+20 app=python3`

const STRUCTURED_LIST = JSON.stringify({
  windows: [
    { window_id: 42, pid: 123, title: "fixture.txt", app_name: "python3" },
    { window_id: 43, pid: 123, title: "kiko-bench-decoy", app_name: "python3" },
  ],
})

const WINDOW_STATE = `Window "fixture.txt" snapshot_id=s0000002a
- [0] frame "fixture.txt"
  - [1] label "Field"
  - [2] entry "kiko-bench-entry" value="seed"
  - [3] push button "OK"`

const DESKTOP_LIST = JSON.stringify([
  { id: "w-1", title: "fixture.txt - Notepad", app_name: "Notepad" },
  { id: "w-2", title: "decoy.txt - Notepad", app_name: "Notepad" },
])

describe("cuaWindows", () => {
  it("reads the macOS window list text and picks the fixture", () => {
    const windows = cuaWindows(MACOS_LIST)
    expect(windows).toEqual([
      { pid: 844, id: 10725, title: "fixture.txt" },
      { pid: 501, id: 999, title: "kiko-bench " },
    ])
    expect(findCuaWindow(windows, "fixture.txt")).toEqual({ pid: 844, id: 10725, title: "fixture.txt" })
  })

  it("reads the Linux window list text", () => {
    expect(cuaWindows(LINUX_LIST)).toEqual([{ pid: 123, id: 42, title: "fixture.txt" }])
  })

  it("reads structured window records first", () => {
    expect(cuaWindows(STRUCTURED_LIST)).toEqual([
      { pid: 123, id: 42, title: "fixture.txt" },
      { pid: 123, id: 43, title: "kiko-bench-decoy" },
    ])
  })
})

describe("findCuaToken", () => {
  it("builds the element token from the snapshot header and the text field row", () => {
    expect(findCuaToken(WINDOW_STATE)).toBe("s0000002a:2")
  })

  it("returns undefined without a snapshot id", () => {
    expect(findCuaToken('- [0] entry "field"')).toBeUndefined()
  })
})

describe("desktopWindow", () => {
  it("finds the window whose title holds the fixture", () => {
    expect(desktopWindow(DESKTOP_LIST, "fixture.txt")).toEqual({ id: "w-1", app: "Notepad" })
  })

  it("returns undefined when no title matches", () => {
    expect(desktopWindow(DESKTOP_LIST, "missing.txt")).toBeUndefined()
  })
})
