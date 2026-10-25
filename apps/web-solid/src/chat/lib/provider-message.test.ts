import { describe, expect, it } from "vitest"
import { providerMessage } from "./provider-message"

describe("providerMessage", () => {
  it("reads the message out of a status code and a JSON error body", () => {
    expect(
      providerMessage(
        '400 {"error":{"message":"The provider asked to wait longer than 60 s before the next request"}}',
      ),
    ).toBe("The provider asked to wait longer than 60 s before the next request.")
  })

  it("reads a top-level message and a nested detail", () => {
    expect(providerMessage('{"message":"overloaded_error"}')).toBe("overloaded_error.")
    expect(providerMessage('429 {"type":"error","error":{"type":"rate_limit_error","message":"Slow down"}}')).toBe(
      "Slow down.",
    )
  })

  it("keeps plain words and drops a bare status code", () => {
    expect(providerMessage("503 Service unavailable")).toBe("Service unavailable.")
    expect(providerMessage("socket hang up.")).toBe("socket hang up.")
  })

  it("gives nothing for empty or unreadable details", () => {
    expect(providerMessage(undefined)).toBeUndefined()
    expect(providerMessage("  ")).toBeUndefined()
    expect(providerMessage("500")).toBeUndefined()
    expect(providerMessage("<html><body>Bad gateway</body></html>")).toBeUndefined()
  })
})
