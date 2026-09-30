import { describe, expect, test } from "bun:test";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampOffset, scaleOffset, zoomBounds } from "./zoom";

/** The stage box every case below is measured in: 4:3, and 200 is a round
 * number of pixels from its centre. */
const RECT = { width: 800, height: 600 };

/**
 * Where a point `displacement` from the box centre ends up on screen under the
 * viewer's transform, `scale(s) translate(-panX, -panY)`.
 *
 * This is the assertion that matters: `scaleOffset` returning a number is not
 * the contract, the pixel under the pointer STAYING PUT is. The helper spells
 * the composition out so a test can check the picture, not the arithmetic.
 */
function onScreen(displacement: number, pan: number, scale: number): number {
  return scale * (displacement - pan);
}

describe("scaleOffset", () => {
  test("a zoom in about a point off the centre moves the frame by half its displacement", () => {
    // The pointer 200px right of the centre of an 800-wide box, zoom 1 → 2.
    const offset = scaleOffset({ x: 600, y: 300, scale: 2, prevScale: 1, rect: RECT });

    // Half of 200: the change in the reciprocal scale, 1 - 1/2. Not the whole
    // displacement (that overshoots and slides the picture off the pointer) and
    // not zero (that drops the anchor and zooms about the centre).
    expect(offset.x).toBeCloseTo(100, 10);
    expect(offset.y).toBeCloseTo(0, 10);
  });

  test("the pixel under the pointer stays under the pointer", () => {
    const displacement = 200;
    const atFit = onScreen(displacement, 0, 1);
    const pan = scaleOffset({ x: 600, y: 300, scale: 2, prevScale: 1, rect: RECT });

    expect(onScreen(displacement, pan.x, 2)).toBeCloseTo(atFit, 10);
  });

  test("the pointer's own side decides the direction", () => {
    const left = scaleOffset({ x: 200, y: 300, scale: 2, prevScale: 1, rect: RECT });
    const above = scaleOffset({ x: 400, y: 100, scale: 2, prevScale: 1, rect: RECT });

    expect(left.x).toBeCloseTo(-100, 10);
    expect(above.y).toBeCloseTo(-100, 10);
  });

  test("no change of scale means no travel", () => {
    expect(scaleOffset({ x: 700, y: 500, scale: 1.5, prevScale: 1.5, rect: RECT })).toEqual({
      x: 0,
      y: 0,
    });
  });

  test("up then back down about the same point is a round trip", () => {
    const up = scaleOffset({ x: 600, y: 300, scale: 2, prevScale: 1, rect: RECT });
    const down = scaleOffset({ x: 600, y: 300, scale: 1, prevScale: 2, rect: RECT });

    expect(up.x + down.x).toBeCloseTo(0, 10);
    expect(up.y + down.y).toBeCloseTo(0, 10);
  });

  test("a scale of zero is a division by zero, not a position", () => {
    expect(scaleOffset({ x: 600, y: 300, scale: 0, prevScale: 1, rect: RECT })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("zoomBounds", () => {
  test("a fitted picture cannot be dragged", () => {
    const bounds = zoomBounds(RECT, 1);

    expect(bounds.minX).toBe(0);
    expect(bounds.maxX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxY).toBe(0);
  });

  test("a picture smaller than the stage cannot be dragged either", () => {
    expect(zoomBounds(RECT, ZOOM_MIN)).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });

  test("the travel is half the overflow, symmetrically", () => {
    const bounds = zoomBounds(RECT, 2);

    // The scaled box is 1600 wide over an 800 stage: 800 of overflow, so 400
    // pixels of screen travel each way. That is 200 in the media's own units,
    // which is what the viewer stores and what the transform scales back up.
    expect(bounds.maxX * 2).toBeCloseTo((RECT.width * 2 - RECT.width) / 2, 10);
    expect(bounds.maxY * 2).toBeCloseTo((RECT.height * 2 - RECT.height) / 2, 10);
    expect(bounds.minX).toBeCloseTo(-bounds.maxX, 10);
    expect(bounds.minY).toBeCloseTo(-bounds.maxY, 10);
  });
});

describe("clampOffset", () => {
  test("never returns an offset outside the bounds", () => {
    for (const scale of [0.5, 1, 1.5, 2, 3, ZOOM_MAX]) {
      const bounds = zoomBounds(RECT, scale);
      for (const x of [-10_000, -200, 0, 1, 200, 10_000]) {
        for (const y of [-10_000, -200, 0, 1, 200, 10_000]) {
          const clamped = clampOffset({ x, y, bounds });

          expect(clamped.x).toBeGreaterThanOrEqual(bounds.minX);
          expect(clamped.x).toBeLessThanOrEqual(bounds.maxX);
          expect(clamped.y).toBeGreaterThanOrEqual(bounds.minY);
          expect(clamped.y).toBeLessThanOrEqual(bounds.maxY);
        }
      }
    }
  });

  test("leaves an offset that is already inside alone", () => {
    const bounds = zoomBounds(RECT, 2);
    const pan = scaleOffset({ x: 600, y: 300, scale: 2, prevScale: 1, rect: RECT });

    expect(clampOffset({ x: pan.x, y: pan.y, bounds })).toEqual(pan);
  });

  test("a drag past the edge stops at the edge, so the media never leaves the stage", () => {
    const bounds = zoomBounds(RECT, 2);
    const clamped = clampOffset({ x: 5_000, y: -5_000, bounds });

    // The media's own edge has reached the stage's: its right edge sits on the
    // stage's right edge, and its top edge on the stage's top edge.
    expect(onScreen(RECT.width / 2, clamped.x, 2)).toBeCloseTo(RECT.width / 2, 10);
    expect(onScreen(-RECT.height / 2, clamped.y, 2)).toBeCloseTo(-RECT.height / 2, 10);
  });
});

describe("the range", () => {
  test("the stepper reaches both ends exactly", () => {
    // `−`/`+` walk by ZOOM_STEP and clamp, so a range the step does not divide
    // leaves a dead step at one end that no key can undo.
    expect((ZOOM_MAX - ZOOM_MIN) / ZOOM_STEP).toBe(7);
  });
});