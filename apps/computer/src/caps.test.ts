import { describe, expect, it, vi } from "vitest"
vi.mock("./terminal/pty", () => ({ hasPty: () => false }))
vi.mock("./live/binary", () => ({ findBinary: () => "/usr/bin/ffmpeg" }))

import { detect } from "./caps"
import type { DriverState } from "./driver"

const log = { warn: () => {}, info: () => {}, error: () => {} }

const state: DriverState = {
  permissions: { accessibility: "granted", screen: "granted", automation: "not_needed" },
  browsers: [],
  displays: [],
  desktop: { version: "0.38.0", tools: [{ name: "screenshot" }] },
}

describe("input permission", () => {
  it("offers input when the Mac has granted accessibility", () => {
    const detection = detect(log, { live: true, input: true }, state, undefined, true)
    expect(detection.caps.input).toBe(true)
  })

  it("refuses input and says what to grant when accessibility is missing", () => {
    const detection = detect(log, { live: true, input: true }, state, undefined, false)
    expect(detection.caps.input).toBe(false)
    expect(detection.reason).toContain("Accessibility permission")
  })
})
