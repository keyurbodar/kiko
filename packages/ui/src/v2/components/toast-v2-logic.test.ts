import { describe, expect, it } from "vitest"
import { toastDuration } from "./toast-v2-logic"

describe("toastDuration", () => {
  it("dismisses plain toasts on their own after about five seconds", () => {
    expect(toastDuration({})).toBe(5000)
    expect(toastDuration({ variant: "success" })).toBe(5000)
  })

  it("keeps an error with an action longer, but still lets it go", () => {
    const longer = toastDuration({ variant: "error", actionable: true })
    expect(longer).toBeGreaterThan(5000)
    expect(Number.isFinite(longer)).toBe(true)
  })

  it("only stays forever when asked to or while loading", () => {
    expect(toastDuration({ persistent: true })).toBe(Number.POSITIVE_INFINITY)
    expect(toastDuration({ variant: "loading" })).toBe(Number.POSITIVE_INFINITY)
  })
})
