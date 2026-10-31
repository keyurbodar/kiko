import { describe, expect, it } from "vitest"
import { osName, unsupportedOs } from "./platform"

describe("platform", () => {
  it("names macOS and Linux", () => {
    expect(osName("darwin")).toBe("macos")
    expect(osName("linux")).toBe("linux")
  })

  it("refuses Windows with one clear message", () => {
    expect(unsupportedOs("win32")).toBe("kiko computer runs on macOS and Linux only")
    expect(unsupportedOs("darwin")).toBeNull()
    expect(unsupportedOs("linux")).toBeNull()
  })
})
