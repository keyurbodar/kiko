import { describe, expect, test } from "bun:test"
import type { RunErrorKind } from "@kiko/protocol"
import { classifyRunError, describeRunError } from "../src/agent/run-error"

describe("classifyRunError", () => {
  const cases: [string, RunErrorKind][] = [
    ["401 {\"error\":{\"message\":\"invalid x-api-key\"}}", "invalid_key"],
    ["Incorrect API key provided", "invalid_key"],
    ["403 permission denied", "invalid_key"],
    ["Your credit balance is too low", "quota"],
    ["You exceeded your current quota", "quota"],
    ["402 payment required", "quota"],
    ["429 Too Many Requests", "rate_limit"],
    ["rate limit reached for requests", "rate_limit"],
    ["404 model gpt-9 not found", "model_not_found"],
    ["The model `foo` does not exist", "model_not_found"],
    ["529 overloaded_error", "overloaded"],
    ["502 Bad Gateway", "overloaded"],
    ["503 service unavailable", "overloaded"],
    ["the model stopped responding and the request timed out", "timeout"],
    ["504 gateway timeout", "timeout"],
    ["fetch failed", "network"],
    ["ECONNRESET", "network"],
    ["prompt is too long: 250000 tokens > 200000 maximum", "too_long"],
    ["This model's maximum context length is 128000 tokens", "too_long"],
    ["The response was blocked by the content filter", "refused"],
    ["something odd happened", "other"],
  ]
  for (const [message, kind] of cases) test(`${message} is ${kind}`, () => expect(classifyRunError(message)).toBe(kind))

  test("a missing message is other", () => expect(classifyRunError(undefined)).toBe("other"))
})

describe("describeRunError", () => {
  const KINDS: RunErrorKind[] = ["no_key", "invalid_key", "quota", "rate_limit", "model_not_found", "network", "overloaded", "timeout", "refused", "too_long", "other"]

  test("every failure has one plain sentence that names the provider and holds nothing the provider said", () => {
    for (const kind of KINDS) {
      const { message } = describeRunError(kind, "OpenCode Go", "Kiko")
      expect(message).toMatch(/^[A-Z].*[.]$/)
      expect(message).not.toMatch(/[{}"]|sk-|\b[45]\d\d\b/)
    }
    expect(describeRunError("rate_limit", "OpenCode Go", "Kiko").message).toBe("OpenCode Go is rate limiting requests. Wait a moment, then retry.")
    expect(describeRunError("no_key", "OpenCode Go", "Kiko").message).toBe("Kiko cannot answer yet. OpenCode Go is not connected.")
  })

  test("what the human can do follows the failure", () => {
    const actions = (kind: RunErrorKind) => describeRunError(kind, "P", "A").actions
    expect(actions("no_key")).toEqual(["open_settings", "retry"])
    expect(actions("invalid_key")).toContain("open_settings")
    expect(actions("model_not_found")).toEqual(["change_model", "open_settings"])
    expect(actions("overloaded")).toEqual(["retry", "change_model"])
    expect(actions("too_long")).toEqual(["change_model"])
  })

  test("a failure the settings fix toasts with the settings action, and a transient one has none", () => {
    expect(describeRunError("invalid_key", "P", "A").toast).toBe("open_models")
    expect(describeRunError("overloaded", "P", "A").toast).toBeUndefined()
    expect(describeRunError("other", "P", "A").toast).toBeUndefined()
  })
})
