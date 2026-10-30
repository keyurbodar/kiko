export type Box = { width: number; height: number }

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const STEP = 1.25
const PADDING = 32

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export function fitScale(natural: Box, panel: Box): number {
  if (!natural.width || !natural.height) return 1
  return Math.min(
    1,
    Math.max(1, panel.width - PADDING) / natural.width,
    Math.max(1, panel.height - PADDING) / natural.height,
  )
}

export function stepZoom(scale: number, direction: 1 | -1): number {
  return clampZoom(direction > 0 ? scale * STEP : scale / STEP)
}
