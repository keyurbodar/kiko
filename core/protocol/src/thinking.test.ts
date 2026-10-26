import { describe, expect, it } from "vitest"
import { defaultThinking } from "./thinking"

describe("defaultThinking", () => {
  it("starts at medium, like pi, when the model offers it", () => {
    expect(defaultThinking(["off", "minimal", "low", "medium", "high"])).toBe("medium")
    expect(defaultThinking(["low", "medium", "high", "xhigh", "max"])).toBe("medium")
  })

  it("takes the next level up, then down, when medium is missing", () => {
    expect(defaultThinking(["off", "low", "high", "max"])).toBe("high")
    expect(defaultThinking(["minimal", "low"])).toBe("low")
  })

  it("stays off for models that cannot reason", () => {
    expect(defaultThinking(["off"])).toBe("off")
    expect(defaultThinking([])).toBe("off")
  })
})
