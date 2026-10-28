import { describe, expect, it } from "vitest"
import { toastDuration } from "./toast-v2-logic"

describe("toastDuration", () => {
  it("dismisses plain toasts on their own after four seconds", () => {
    expect(toastDuration({})).toBe(4000)
    expect(toastDuration({ variant: "success" })).toBe(4000)
  })

  it("keeps a toast with an action longer, but still lets it go", () => {
    expect(toastDuration({ actionable: true })).toBe(8000)
    expect(toastDuration({ variant: "error", actionable: true })).toBe(8000)
  })

  it("only stays forever when asked to or while loading", () => {
    expect(toastDuration({ persistent: true })).toBe(Number.POSITIVE_INFINITY)
    expect(toastDuration({ variant: "loading" })).toBe(Number.POSITIVE_INFINITY)
  })
})
