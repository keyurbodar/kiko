/**
 * The viewer's gesture arithmetic: what a swipe means, how far a pinch has
 * zoomed, and where a thumbnail sits relative to the picture it opens.
 *
 * PURE, like `zoom.ts`. The viewer measures, feeds numbers in, and applies what
 * comes back, so every threshold here has a test that fails when it moves.
 */

import { ZOOM_MAX, ZOOM_MIN } from "./zoom"

/** tweb's `percents > .2` of the window (`base.ts:550`). */
export const SWIPE_FRACTION = 0.2

/** The travel that commits a swipe on a wide window, where 20 percent is a long way. */
export const SWIPE_MAX_PX = 125

/** Travel before a drag picks an axis. Below it the finger is still settling. */
export const AXIS_SLOP = 8

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export type SwipeAxis = "x" | "y"

export type SwipeResult = "previous" | "next" | "close" | "stay"

/** The travel along one axis that commits a swipe: 20 percent of it, or 125 px, whichever is less. */
export function swipeThreshold(extent: number): number {
  return Math.min(extent * SWIPE_FRACTION, SWIPE_MAX_PX)
}

/** Which axis a drag belongs to, or `null` while it has not moved enough to say. */
export function lockAxis(dx: number, dy: number): SwipeAxis | null {
  if (Math.hypot(dx, dy) < AXIS_SLOP) return null
  return Math.abs(dx) >= Math.abs(dy) ? "x" : "y"
}

/**
 * What a released drag does. A drag to the right goes back (`base.ts:552`), a
 * vertical drag in either direction closes, and a horizontal drag past the end
 * of the album stays where it is.
 */
export function resolveSwipe(input: {
  axis: SwipeAxis | null
  dx: number
  dy: number
  width: number
  height: number
  hasPrevious: boolean
  hasNext: boolean
}): SwipeResult {
  if (input.axis === "x") {
    if (Math.abs(input.dx) <= swipeThreshold(input.width)) return "stay"
    if (input.dx > 0) return input.hasPrevious ? "previous" : "stay"
    return input.hasNext ? "next" : "stay"
  }
  if (input.axis === "y") {
    return Math.abs(input.dy) > swipeThreshold(input.height) ? "close" : "stay"
  }
  return "stay"
}

/** The scale after a pinch: the starting scale times how far the fingers spread, clamped. */
export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startScale
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (startScale * distance) / startDistance))
}

/** The rectangle `media` occupies when contained in `stage`. A media of unknown size fills the stage. */
export function containRect(stage: Box, media: { width: number; height: number }): Box {
  if (media.width <= 0 || media.height <= 0) return stage
  const fit = Math.min(stage.width / media.width, stage.height / media.height)
  const width = media.width * fit
  const height = media.height * fit
  return {
    left: stage.left + (stage.width - width) / 2,
    top: stage.top + (stage.height - height) / 2,
    width,
    height,
  }
}

export interface Flight {
  x: number
  y: number
  scale: number
}

/**
 * The transform that lays `picture` over `thumb`: a translate between the
 * centres and one uniform scale that covers the thumbnail, which is how the
 * thumbnail crops it. Apply it with the transform origin at the picture's
 * centre, as `translate(x, y) scale(s)`.
 */
export function flightTransform(picture: Box, thumb: Box): Flight {
  return {
    x: thumb.left + thumb.width / 2 - (picture.left + picture.width / 2),
    y: thumb.top + thumb.height / 2 - (picture.top + picture.height / 2),
    scale: Math.max(thumb.width / picture.width, thumb.height / picture.height),
  }
}

export function flightCss(flight: Flight): string {
  return `translate(${flight.x}px, ${flight.y}px) scale(${flight.scale})`
}
