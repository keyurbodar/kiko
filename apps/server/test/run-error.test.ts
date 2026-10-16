import { describe, expect, test } from "bun:test"
import { classifyRunError, scrubDetail } from "../src/agent/run-error"

describe("classifyRunError", () => {
  const cases: [string, string][] = [
    ["401 {\"error\":{\"message\":\"invalid x-api-key\"}}", "invalid_key"],
    ["Incorrect API key provided", "invalid_key"],
    ["403 permission denied", "invalid_key"],
    ["Your credit balance is too low", "invalid_key"],
    ["429 Too Many Requests", "rate_limit"],
    ["rate limit reached for requests", "rate_limit"],
    ["You exceeded your current quota", "rate_limit"],
    ["529 overloaded_error", "provider_down"],
    ["502 Bad Gateway", "provider_down"],
    ["fetch failed", "provider_down"],
    ["prompt is too long: 250000 tokens > 200000 maximum", "too_long"],
    ["This model's maximum context length is 128000 tokens", "too_long"],
    ["The response was blocked by the content filter", "refused"],
    ["something odd happened", "other"],
  ]
  for (const [message, kind] of cases) test(`${message} is ${kind}`, () => expect(classifyRunError(message)).toBe(kind as never))

  test("a missing message is other", () => expect(classifyRunError(undefined)).toBe("other"))
})

describe("scrubDetail", () => {
  test("a key echoed by the provider never survives", () => {
    const out = scrubDetail("Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789")
    expect(out).not.toContain("abcdefghij")
    expect(out).not.toContain("sk-proj")
  })
  test("a long message is cut", () => expect(scrubDetail("word ".repeat(100)).length).toBeLessThanOrEqual(200))
})
