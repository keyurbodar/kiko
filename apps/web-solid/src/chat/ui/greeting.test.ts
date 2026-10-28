import { describe, expect, it } from "vitest"
import { greeting } from "./EmptyState"

describe("greeting", () => {
  it("greets the owner by first name for the time of day", () => {
    expect(greeting("Mirai Tanaka", new Date(2026, 9, 28, 19, 0))).toBe("Evening, Mirai")
    expect(greeting("Mirai", new Date(2026, 9, 28, 9, 0))).toBe("Morning, Mirai")
    expect(greeting("Mirai", new Date(2026, 9, 28, 14, 0))).toBe("Afternoon, Mirai")
  })

  it("asks an open question when it does not know the owner's name", () => {
    expect(greeting(undefined, new Date(2026, 9, 28, 19, 0))).toBe("What's on your mind?")
    expect(greeting("  ", new Date(2026, 9, 28, 19, 0))).toBe("What's on your mind?")
  })
})
