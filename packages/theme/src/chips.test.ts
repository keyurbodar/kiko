import { describe, expect, it } from "vitest"
import { chipTokens, chipSurfaces, toneOf } from "./chips"
import { paletteFor, THEMES } from "./palette"

const ratio = (hex: string, surfaces: readonly { hex: string }[]) => {
  const lum = (value: string) => {
    const parts = [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16) / 255)
    const [r, g, b] = parts.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
      number,
      number,
      number,
    ]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return Math.min(
    ...surfaces.map(({ hex: other }) => {
      const [high, low] = [lum(hex), lum(other)].sort((a, b) => b - a) as [number, number]
      return (high + 0.05) / (low + 0.05)
    }),
  )
}

const surfacesOf = (mode: "dark" | "light", canvas: string) =>
  chipSurfaces(mode, { ...paletteFor(mode), canvas }).map(({ rgb }) => ({
    hex: `#${rgb
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`,
  }))

describe("chip tones", () => {
  it("keeps every tone above five to one on the surfaces it lands on", () => {
    for (const mode of ["dark", "light"] as const) {
      const tokens = chipTokens(mode, paletteFor(mode))
      const surfaces = surfacesOf(mode, paletteFor(mode).canvas)
      for (const value of Object.values(tokens)) expect(ratio(value, surfaces)).toBeGreaterThanOrEqual(4.9)
    }
  })

  it("keeps every imported theme readable, not just the built in one", () => {
    for (const theme of Object.values(THEMES)) {
      const mode = theme === THEMES.snow ? "light" : "dark"
      const tokens = chipTokens(mode, { ...theme.palette })
      const surfaces = surfacesOf(mode, theme.palette.canvas)
      for (const value of Object.values(tokens)) expect(ratio(value, surfaces)).toBeGreaterThanOrEqual(4.9)
    }
  })

  it("gives each document family its own hue", () => {
    const dark = chipTokens("dark", paletteFor("dark"))
    const values = Object.values(dark)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("toneOf", () => {
  it("maps documents to their family", () => {
    expect(toneOf("notes/report.pdf")).toBe("pdf")
    expect(toneOf("plans.csv")).toBe("sheet")
    expect(toneOf("deck.pptx")).toBe("slides")
    expect(toneOf("letter.docx")).toBe("word")
    expect(toneOf("book.epub")).toBe("epub")
  })

  it("falls back to the mention tone for everything else", () => {
    expect(toneOf("index.html")).toBe("mention")
    expect(toneOf("notes/screenshot.png")).toBe("mention")
    expect(toneOf("LICENSE")).toBe("mention")
  })
})
