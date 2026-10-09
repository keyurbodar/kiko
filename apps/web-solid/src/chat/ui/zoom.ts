/*
 * The image dialog's zoom and pan, as numbers, after t3code's ZoomableImage. No Solid and no DOM,
 * so the cases are tested as data. Zoom is a factor over the picture fitted to the window: 1 is
 * fitted, 8 is the most.
 */

export const MAX_ZOOM = 8
/** How far an arrow key pans a zoomed picture, in pixels. */
export const PAN_STEP = 40

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(1, zoom))

/** The tallest the picture may be: 86% of the window, leaving 160 px for the caption and close button. */
export const maxHeight = (window: Size) => Math.max(1, Math.min(window.height * 0.86, window.height - 160))

/** The scale that fits a picture in the window, never above its own size. Wide windows keep 48 px each side for the arrows. */
export function fitScale(natural: Size, window: Size): number {
	return Math.min(1, (window.width * 0.92 - (window.width >= 640 ? 96 : 0)) / (natural.width || 1), maxHeight(window) / (natural.height || 1))
}

/**
 * One wheel step. A line or page delta counts as pixels first. A pinch on a trackpad arrives as
 * a wheel with ctrl held and small deltas, so it zooms faster per pixel.
 */
export function wheelZoom(zoom: number, wheel: { deltaY: number; deltaMode: number; ctrlKey: boolean }, pageHeight: number): number {
	const pixels = wheel.deltaY * (wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? pageHeight : 1)
	return clampZoom(zoom * Math.exp(-pixels * (wheel.ctrlKey ? 0.01 : 0.002)))
}

/** The zoom a key asks for, or null when the key is not a zoom key. Enter and space toggle 1x and 2x. */
export function keyZoom(key: string, zoom: number): number | null {
	if (key === "Enter" || key === " ") return zoom > 1 ? 1 : 2
	if (key === "+" || key === "=") return clampZoom(zoom * 1.5)
	if (key === "-") return clampZoom(zoom / 1.5)
	if (key === "0") return 1
	return null
}

/** A click toggles between fitted and 2x. */
export const clickZoom = (zoom: number) => (zoom > 1 ? 1 : 2)

/** The point of the unzoomed picture under `at`, a point in the viewport, given its scroll. */
export const anchorAt = (scroll: Point, at: Point, zoom: number): Point => ({ x: (scroll.x + at.x) / zoom, y: (scroll.y + at.y) / zoom })

/** The scroll that puts `anchor` back under `at` at the new zoom. */
export const scrollFor = (anchor: Point, at: Point, zoom: number): Point => ({ x: anchor.x * zoom - at.x, y: anchor.y * zoom - at.y })

/** How an arrow key pans, or null for any other key. */
export function panStep(key: string): Point | null {
	if (key === "ArrowLeft") return { x: -PAN_STEP, y: 0 }
	if (key === "ArrowRight") return { x: PAN_STEP, y: 0 }
	if (key === "ArrowUp") return { x: 0, y: -PAN_STEP }
	if (key === "ArrowDown") return { x: 0, y: PAN_STEP }
	return null
}
