/**
 * The viewer's zoom and pan arithmetic, and nothing else.
 *
 * Straight port of tweb's `MediaViewerBase` zoom half: `ZOOM_STEP` and the
 * min/max from `base.ts:86-89`, `calculateScaleOffset` (`:725`) and
 * `calculateOffsetBoundaries`/`getZoomBoundaries` (`:800-838`). Everything that
 * made those worth porting is here — the shared-element open/close transition,
 * the rotation refit and the bounce-back live in `base.ts` and are NOT ported:
 * they are Telegram's, and a kiko viewer appears and disappears instantly.
 *
 * PURE. No DOM, no Solid, no signals: the viewer measures its own box, feeds
 * the numbers in and renders what comes back. That is what makes the rounding
 * claims in `zoom.test.ts` testable at all — tweb's version reads
 * `windowSize` and `getBoundingClientRect` from inside the calculation, so
 * there is nothing to assert about it.
 *
 * Units. The offset is a PAN in the MEDIA's own coordinates — the same units as
 * the box the picture is fitted into, not screen pixels, and positive means the
 * picture moves LEFT under the frame. The viewer composes it as
 * `scale(s) translate(-x, -y)`, so the browser scales the translate along with
 * the picture and one unit here is `s` pixels on screen. Every bound below is
 * in these units too, which is why the travel reads as half the overflow
 * divided by the scale: the transform multiplies it back.
 */

/** One step of the zoom pill and of `+`/`-`. tweb's `ZOOM_STEP`. */
export const ZOOM_STEP = 0.5

/**
 * tweb's `ZOOM_MIN_VALUE`. Below 1 the picture is smaller than the stage, so
 * `zoomBounds` pins both axes to 0 and there is nothing to pan; the stepper can
 * still walk there, which is what makes the `−` button stop rather than die at
 * fit.
 */
export const ZOOM_MIN = 0.5

/** tweb's `ZOOM_MAX_VALUE`. Above this the pixels are mush and the pan is unusable. */
export const ZOOM_MAX = 4

/** The scale a picture sits at when it is fitted to the stage. */
export const ZOOM_FIT = 1

/** A pan of the media, in the media's own units. */
export interface ZoomOffset {
  x: number
  y: number
}

/** The four walls an offset may not pass, in the media's own units. */
export interface ZoomBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * How far the frame pans when the scale changes, to keep the pixel under
 * `x`/`y` under the pointer.
 *
 * tweb's `calculateScaleOffset` is `x - factor * x` on the zoom centre, run
 * with the centre in SCREEN coordinates over a box that fills the window, so
 * the window's half-width bias rides along in the number. This is the same
 * arithmetic with that bias taken out and expressed in the media's own units,
 * where a change from `prevScale` to `scale` moves the frame by the CHANGE in
 * the reciprocal scale: `1 / prevScale - 1 / scale`.
 *
 * The offset is a PAN, not a translation: positive `x` drags the picture LEFT
 * under the frame, the way a scroll offset reads. The viewer composes it as
 * `scale(s) translate(-x, -y)` about the box's centre, and under that
 * composition a point `d` from the centre sits at `s * (d - offset)` from it —
 * so holding `d` still means exactly the delta below. It is also why the
 * answer is antisymmetric: zooming up by `f` and back by `1 / f` about the
 * same point returns the offset it started from, which is what `zoom.test.ts`
 * asserts.
 *
 * The offset returned is INCREMENTAL: add it to the pan the media already has.
 * An absolute reading would need the current offset passed in too, and the
 * caller has it.
 */
export function scaleOffset(opts: {
  /** The pointer, in `rect`'s coordinates. */
  x: number
  y: number
  /** The scale being moved TO. */
  scale: number
  /** The scale being moved FROM. */
  prevScale: number
  /** The box the picture is fitted into; its centre is the transform origin. */
  rect: { width: number; height: number }
}): ZoomOffset {
  const { x, y, scale, prevScale, rect } = opts
  // A scale of zero is a division by zero rather than a position, and it is not
  // reachable from the viewer's clamped range — but this is a pure function
  // other code can call, so it does not get to return Infinity.
  if (!(scale > 0) || !(prevScale > 0)) return { x: 0, y: 0 }

  const growth = 1 / prevScale - 1 / scale
  return {
    x: (x - rect.width / 2) * growth,
    y: (y - rect.height / 2) * growth,
  }
}

/**
 * The walls an offset may not pass at `scale`, in the media's own units.
 *
 * tweb's `calculateOffsetBoundaries` over `getZoomBoundaries` (`base.ts:800`),
 * with the window-centre bias dropped: there the minimum came from
 * `Math.max(-rect.left * scale, centerX)` and the maximum from
 * `windowSize.width - rect.right * scale`, because its offset is a
 * screen-space translation. Here the offset is scaled with the picture, so the
 * travel is half the overflow of the scaled box over the stage —
 * `(rect * scale - rect) / 2` on screen — divided by the scale, and the browser
 * multiplies it back.
 *
 * At scale 1 that is zero on both axes: a fitted picture has no slack, so it
 * cannot be dragged at all, and a drag at fit is a swipe to the next item
 * instead. Below 1 the picture is smaller than the stage and `max(0, …)` pins it
 * the same way. Past 1 it is exactly the overflow, so the media can be dragged
 * until its own edge meets the stage and no further — never off it.
 */
export function zoomBounds(
  rect: { width: number; height: number },
  scale: number,
): ZoomBounds {
  const travelX = Math.max(0, (rect.width * (scale - 1)) / 2 / scale)
  const travelY = Math.max(0, (rect.height * (scale - 1)) / 2 / scale)
  // `0 - 0` rather than `-0`: a wall at negative zero reads as a negative
  // number to anything comparing it with `Object.is`, and a fitted picture has
  // no walls at all.
  return { minX: 0 - travelX, maxX: travelX, minY: 0 - travelY, maxY: travelY }
}

/**
 * Pulls an offset back inside `bounds`.
 *
 * tweb does this inline in `calculateOffsetBoundaries` and returns the
 * out-of-bounds flags alongside the clamped value, because it re-shows the
 * viewer when a drag pushes past an edge (the bounce-back). There is no
 * bounce-back here, so all that survives is the clamp itself.
 */
export function clampOffset(opts: {
  x: number
  y: number
  bounds: ZoomBounds
}): ZoomOffset {
  const { x, y, bounds } = opts
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
  }
}