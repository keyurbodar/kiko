import { describe, expect, it } from "@effect/vitest"
import { vi } from "vitest"
import { launchCommand, parseAccess } from "./macos"

vi.mock("bun:ffi", () => ({ dlopen: () => ({ symbols: {} }), FFIType: {} }))

describe("launching an app, url or path", () => {
  it("asks open for an app by name", () => {
    expect(launchCommand("Safari")).toEqual(["open", "-a", "Safari"])
    expect(launchCommand("Visual Studio Code")).toEqual(["open", "-a", "Visual Studio Code"])
  })

  it("hands urls and paths to open untouched", () => {
    expect(launchCommand("https://example.com")).toEqual(["open", "https://example.com"])
    expect(launchCommand("mailto:owner@example.com")).toEqual(["open", "mailto:owner@example.com"])
    expect(launchCommand("/Applications/Safari.app")).toEqual(["open", "/Applications/Safari.app"])
    expect(launchCommand("~/Desktop")).toEqual(["open", "~/Desktop"])
  })
})

describe("reading the access answer", () => {
  it("keeps the two permission flags", () => {
    expect(parseAccess('{"screen":true,"input":false}')).toEqual({ screen: true, input: false })
  })

  it("rejects anything that is not an access answer", () => {
    expect(parseAccess("not json")).toBeNull()
    expect(parseAccess("null")).toBeNull()
    expect(parseAccess('{"screen":"yes","input":true}')).toBeNull()
    expect(parseAccess('{"screen":true}')).toBeNull()
  })
})
