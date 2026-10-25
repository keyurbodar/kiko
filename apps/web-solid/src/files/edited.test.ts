import { describe, expect, it } from "vitest"
import { editedText } from "./edited"

const NOW = Date.UTC(2026, 9, 25, 12)
const DAY = 86_400_000

describe("editedText", () => {
  it("says just now for a fresh or very recent file", () => {
    expect(editedText(Number.MAX_SAFE_INTEGER, NOW)).toBe("Just now")
    expect(editedText(NOW - 20_000, NOW)).toBe("Just now")
  })

  it("counts minutes, hours and days back", () => {
    expect(editedText(NOW - 5 * 60_000, NOW)).toBe("5 minutes ago")
    expect(editedText(NOW - 3 * 3_600_000, NOW)).toBe("3 hours ago")
    expect(editedText(NOW - 2 * DAY, NOW)).toBe("2 days ago")
    expect(editedText(NOW - DAY, NOW)).toBe("yesterday")
  })

  it("moves up to months and years", () => {
    expect(editedText(NOW - 65 * DAY, NOW)).toBe("2 months ago")
    expect(editedText(NOW - 800 * DAY, NOW)).toBe("2 years ago")
  })
})
