import { describe, expect, test } from "bun:test"
import { runErrorToast } from "./run-error"

const kinds = ["no_key", "invalid_key", "rate_limit", "provider_down", "refused", "too_long", "other"] as const

describe("runErrorToast", () => {
  test("every kind is a short sentence-case title", () => {
    for (const kind of kinds) {
      const { title } = runErrorToast({ kind, provider: "anthropic" }, "Kiko")
      expect(title.length).toBeGreaterThan(0)
      expect(title.length).toBeLessThan(60)
      expect(title).not.toMatch(/^[a-z]/)
    }
  })
  test("only the kinds a key fixes offer settings", () => {
    expect(kinds.filter((kind) => runErrorToast({ kind }, "Kiko").settings)).toEqual(["no_key", "invalid_key"])
  })
  test("the provider and the agent are named", () => {
    expect(runErrorToast({ kind: "rate_limit", provider: "openai" }, "Kiko").title).toContain("Openai")
    expect(runErrorToast({ kind: "no_key", provider: "anthropic" }, "Jev").title).toContain("Jev")
  })
  test("an unknown error carries its detail, and no other kind does", () => {
    expect(runErrorToast({ kind: "other", detail: "odd failure" }, "Kiko").description).toBe("odd failure")
    expect(runErrorToast({ kind: "rate_limit", detail: "odd failure" }, "Kiko").description).not.toContain("odd failure")
  })
})
