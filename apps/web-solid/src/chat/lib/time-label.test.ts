import { describe, expect, it } from "vitest"
import { dividerParts } from "./time-label"

const AT = new Date(2026, 9, 28, 14, 30).getTime()

describe("dividerParts", () => {
  it("shows the time in the locale's own clock", () => {
    expect(dividerParts(AT, AT, { locale: "en-US" }).time).toBe("2:30 PM")
    expect(dividerParts(AT, AT, { locale: "de-DE" }).time).toBe("14:30")
  })
})
