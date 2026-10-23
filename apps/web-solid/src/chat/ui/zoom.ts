export const MAX_ZOOM = 8
export const PAN_STEP = 40

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(1, zoom))

export const maxHeight = (window: Size) => Math.max(1, Math.min(window.height * 0.86, window.height - 160))

export function fitScale(natural: Size, window: Size): number {
  return Math.min(
    1,
    (window.width * 0.92 - (window.width >= 640 ? 96 : 0)) / (natural.width || 1),
    maxHeight(window) / (natural.height || 1),
  )
}

export function wheelZoom(
  zoom: number,
  wheel: { deltaY: number; deltaMode: number; ctrlKey: boolean },
  pageHeight: number,
): number {
  const pixels = wheel.deltaY * (wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? pageHeight : 1)
  return clampZoom(zoom * Math.exp(-pixels * (wheel.ctrlKey ? 0.01 : 0.002)))
}

export function keyZoom(key: string, zoom: number): number | null {
  if (key === "Enter" || key === " ") return zoom > 1 ? 1 : 2
  if (key === "+" || key === "=") return clampZoom(zoom * 1.5)
  if (key === "-") return clampZoom(zoom / 1.5)
  if (key === "0") return 1
  return null
}

export const clickZoom = (zoom: number) => (zoom > 1 ? 1 : 2)

export const anchorAt = (scroll: Point, at: Point, zoom: number): Point => ({
  x: (scroll.x + at.x) / zoom,
  y: (scroll.y + at.y) / zoom,
})

export const scrollFor = (anchor: Point, at: Point, zoom: number): Point => ({
  x: anchor.x * zoom - at.x,
  y: anchor.y * zoom - at.y,
})

export function panStep(key: string): Point | null {
  if (key === "ArrowLeft") return { x: -PAN_STEP, y: 0 }
  if (key === "ArrowRight") return { x: PAN_STEP, y: 0 }
  if (key === "ArrowUp") return { x: 0, y: -PAN_STEP }
  if (key === "ArrowDown") return { x: 0, y: PAN_STEP }
  return null
}
