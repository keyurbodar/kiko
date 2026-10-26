import { describe, expect, it } from "vitest"
import { classifyRunError, runErrorDetail } from "./run-error"

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

describe("limits that clear later", () => {
  const now = Date.parse("2026-10-26T12:00:00Z")

  it("reads a usage limit with a known reset as a rate limit", () => {
    expect(classifyRunError("You have hit your usage limit. resets_in_seconds: 3900", now)).toBe("rate_limit")
    expect(classifyRunError("usage limit reached, try again in 20 min", now)).toBe("rate_limit")
  })

  it("keeps a usage limit with no reset as quota", () => {
    expect(classifyRunError("You have hit your usage limit", now)).toBe("quota")
  })

  it("leads the detail with the reset time", () => {
    expect(runErrorDetail("usage limit reached, try again in 65 min", now)).toBe(
      "resets_at=2026-10-26T13:05:00.000Z usage limit reached, try again in 65 min",
    )
    expect(runErrorDetail("socket hang up", now)).toBe("socket hang up")
  })
})
