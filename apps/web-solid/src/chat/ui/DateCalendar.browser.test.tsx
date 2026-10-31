import { describe, expect, it } from "vitest"
import { firstDayOfWeek } from "./DateCalendar"

describe("firstDayOfWeek", () => {
  it("starts the week on the locale's own first day", () => {
    expect(firstDayOfWeek("en-US")).toBe(0)
    expect(firstDayOfWeek("de-DE")).toBe(1)
    expect(firstDayOfWeek("ar-EG")).toBe(6)
  })
})
