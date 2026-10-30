import { describe, expect, it } from "vitest"
import {
  currentPdfPage,
  pdfPageOffsets,
  pdfPageScrollTop,
  pdfPageWidth,
  stepPdfZoom,
  visiblePdfPages,
} from "./pdf-layout"

describe("pdfPageWidth", () => {
  it("fits the page to the panel with a gap on each side", () => {
    expect(pdfPageWidth(800, 612, null)).toEqual({ scale: 768 / 612, width: 768 })
  })

  it("uses the zoom as an absolute scale when one is set", () => {
    expect(pdfPageWidth(800, 612, 0.5)).toEqual({ scale: 0.5, width: 306 })
  })

  it("never fits to a negative width", () => {
    expect(pdfPageWidth(10, 612, null).width).toBe(1)
  })
})

describe("stepPdfZoom", () => {
  it("steps a quarter and stops at the limits", () => {
    expect(stepPdfZoom(1, 1)).toBe(1.25)
    expect(stepPdfZoom(1.25, -1)).toBe(1)
    expect(stepPdfZoom(2.9, 1)).toBe(3)
    expect(stepPdfZoom(0.3, -1)).toBe(0.25)
  })
})

describe("page offsets", () => {
  const ratios = [1, 0.5, 1.5]

  it("stacks pages with a gap before each one", () => {
    expect(pdfPageOffsets(ratios, 400)).toEqual([16, 432, 648, 1264])
  })

  it("finds the page under the reading position", () => {
    const offsets = pdfPageOffsets(ratios, 400)
    expect(currentPdfPage(offsets, ratios.length, 0)).toBe(0)
    expect(currentPdfPage(offsets, ratios.length, 500)).toBe(1)
    expect(currentPdfPage(offsets, ratios.length, 1200)).toBe(2)
  })

  it("keeps one viewport above and two below mounted", () => {
    const offsets = pdfPageOffsets(ratios, 400)
    expect(visiblePdfPages(ratios, offsets, 0, 600).map((page) => page.index)).toEqual([0, 1, 2])
    expect(visiblePdfPages(ratios, offsets, 1500, 600).map((page) => page.index)).toEqual([2])
  })

  it("scrolls to the top of a page", () => {
    const offsets = pdfPageOffsets(ratios, 400)
    expect(pdfPageScrollTop(offsets, 0)).toBe(0)
    expect(pdfPageScrollTop(offsets, 2)).toBe(632)
  })
})
