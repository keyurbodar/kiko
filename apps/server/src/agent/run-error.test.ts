import { describe, expect, it } from "vitest"
import { classifyRunError } from "./run-error"

describe("run error kinds", () => {
  it("does not blame the network when the run used up its call budget", () => {
    expect(
      classifyRunError(
        "This run reached its network call budget during a tool. Completed actions were kept. Check those actions before retrying.",
      ),
    ).toBe("other")
    expect(classifyRunError("fetch failed: network connection lost")).toBe("network")
  })
})
