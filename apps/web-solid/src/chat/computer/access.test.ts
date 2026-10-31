import type { ComputerSummary } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { backgroundHint, browserHints } from "./access"

const computer = (extra: Partial<ComputerSummary> = {}): ComputerSummary => ({
  id: "pc-1",
  name: "Mac",
  os: "macos",
  online: true,
  caps: { shell: true, files: true, desktop: true, live: true, input: true },
  holder: "agent",
  displays: [],
  background: true,
  browsers: [],
  ...extra,
})

describe("backgroundHint", () => {
  it("says it works in the background when the kiko app reports accessibility", () => {
    expect(backgroundHint(computer())).toBe("Works in the background")
  })

  it("asks for Accessibility on macOS once the kiko app is there", () => {
    const hint = backgroundHint(computer({ background: false, browsers: [{ name: "chrome", state: "connected" }] }))
    expect(hint).toContain("Allow Accessibility for kiko")
  })

  it("asks the owner to install the kiko app when it is missing", () => {
    expect(backgroundHint(computer({ background: false }))).toContain("Install the kiko app")
  })
})

describe("browserHints", () => {
  it("names each browser and its state", () => {
    const hints = browserHints(
      computer({
        browsers: [
          { name: "chrome", state: "connected" },
          { name: "edge", state: "not_running" },
        ],
      }),
    )
    expect(hints).toEqual(["Chrome: connected", "Edge: not open"])
  })

  it("gives the inspect address when remote debugging is off", () => {
    const hints = browserHints(computer({ browsers: [{ name: "brave", state: "needs_consent" }] }))
    expect(hints[0]).toContain("Brave: turn on remote debugging once")
    expect(hints[0]).toContain("brave://inspect")
  })
})
