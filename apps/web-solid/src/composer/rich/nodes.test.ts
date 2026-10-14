import { describe, expect, test } from "bun:test"
import { middleTruncate } from "./nodes"

describe("middleTruncate", () => {
  test("a name that fits is left whole", () => {
    expect(middleTruncate("notes.pdf")).toBe("notes.pdf")
    const exact = "a".repeat(30) + ".pdf"
    expect(middleTruncate(exact)).toBe(exact)
  })

  test("a long name keeps its start and its extension, and fits the chip", () => {
    const name = "quarterly-financial-report-final-version-2026-reviewed.pdf"
    const out = middleTruncate(name)
    expect(out.length).toBeLessThanOrEqual(36)
    expect(out.startsWith("quarterly")).toBe(true)
    expect(out.endsWith(".pdf")).toBe(true)
    expect(out).toContain("…")
  })

  test("a long name with no extension still fits", () => {
    expect(middleTruncate("x".repeat(80)).length).toBeLessThanOrEqual(36)
  })
})
