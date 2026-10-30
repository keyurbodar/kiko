const PAGE_GAP = 16
export const PDF_MIN_ZOOM = 0.25
export const PDF_MAX_ZOOM = 3
const ZOOM_STEP = 0.25

export function pdfPageWidth(viewportWidth: number, pageWidth: number, zoom: number | null) {
  const fitWidth = Math.max(1, viewportWidth - 2 * PAGE_GAP)
  return {
    scale: zoom ?? fitWidth / pageWidth,
    width: zoom === null ? fitWidth : pageWidth * zoom,
  }
}

export function stepPdfZoom(scale: number, direction: 1 | -1) {
  return direction > 0 ? Math.min(PDF_MAX_ZOOM, scale + ZOOM_STEP) : Math.max(PDF_MIN_ZOOM, scale - ZOOM_STEP)
}

export function pdfPageOffsets(ratios: readonly number[], width: number) {
  const result = [PAGE_GAP]
  for (const ratio of ratios) result.push(result[result.length - 1]! + width * ratio + PAGE_GAP)
  return result
}

export function currentPdfPage(offsets: readonly number[], pageCount: number, scrollTop: number) {
  for (let index = 0; index < pageCount; index++) {
    if (offsets[index + 1]! > scrollTop + PAGE_GAP + 1) return index
  }
  return 0
}

export function visiblePdfPages(
  ratios: readonly number[],
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
) {
  return ratios.flatMap((ratio, index) =>
    offsets[index + 1]! >= scrollTop - viewportHeight && offsets[index]! <= scrollTop + viewportHeight * 2
      ? [{ index, ratio }]
      : [],
  )
}

export function pdfPageScrollTop(offsets: readonly number[], index: number) {
  return Math.max(0, (offsets[index] ?? PAGE_GAP) - PAGE_GAP)
}
