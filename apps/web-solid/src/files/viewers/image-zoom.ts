export type Box = { width: number; height: number }

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const STEP = 1.25
const PADDING = 32

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

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

export function keyZoom(key: string, scale: number, fit: number): number | null {
  if (key === "+" || key === "=") return stepZoom(scale, 1)
  if (key === "-" || key === "_") return stepZoom(scale, -1)
  if (key === "0") return fit
  return null
}

export function clickZoom(scale: number, fit: number): number {
  return scale > fit * 1.001 ? fit : clampZoom(fit * 2)
}

export function doubleClickZoom(scale: number, fit: number): number {
  return Math.abs(scale - 1) < 0.001 ? fit : 1
}
