import { describe, expect, test } from "bun:test";
import {
  EXPAND_TEXT_WIDTH,
  MIN_IMAGE_WIDTH,
  MIN_SIDE_SIZE,
  MIN_VIDEO_SIDE_SIZE,
  RectPart,
  albumLayout,
  fitInBox,
  singleMediaBox,
  type AlbumRect,
  type MediaSize,
} from "./album";

/**
 * The numbers below are tweb's, not this file's. They were taken by running
 * tweb's own `Layouter` (solid-refs/tweb/src/components/groupedLayout.ts) plus
 * `prepareAlbum`'s container derivation, and the port was then checked against
 * it over the cases here plus a randomized sweep of sizes and box options.
 * Re-deriving an "equivalent" formula in album.ts must change these.
 */

/** `[x, y, width, height, sides]`, the shape every assertion reads best in. */
const box = (rect: AlbumRect) => [rect.x, rect.y, rect.width, rect.height, rect.sides];

const sq = (n: number): MediaSize[] => Array.from({ length: n }, () => ({ w: 1, h: 1 }));

describe("albumLayout", () => {
  test("splits two squares into equal cells and reports a 420-wide container", () => {
    // Two squares are 'qq' with an average ratio of 1, so the equal branch: each
    // cell is (420 - 1) / 2 = 209.5 wide and Math.round(209.5) = 210 tall. The
    // container width is the right cell's x + width, so 210.5 + 209.5 = 420.
    const layout = albumLayout([
      { w: 1, h: 1 },
      { w: 1, h: 1 },
    ]);
    expect(layout.width).toBe(420);
    expect(layout.height).toBe(210);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 209.5, 210, RectPart.Top | RectPart.Left | RectPart.Bottom],
      [210.5, 0, 209.5, 210, RectPart.Top | RectPart.Right | RectPart.Bottom],
    ]);
  });

  test("stacks two wide items when they are wide enough and near-equal", () => {
    // 'ww' with an average ratio of 1.78 over a 1.4 * (420 / 420) threshold, and
    // ratios within 0.2 of each other, so the top/bottom branch: each cell is
    // round(min(420 / 1.78, (420 - 1) / 2)) = round(209.5) = 210, and the
    // container is 210 + 1 + 210 = 421 tall.
    const layout = albumLayout([
      { w: 1.78, h: 1 },
      { w: 1.78, h: 1 },
    ]);
    expect(layout.width).toBe(420);
    expect(layout.height).toBe(421);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 420, 210, RectPart.Left | RectPart.Top | RectPart.Right],
      [0, 211, 420, 210, RectPart.Left | RectPart.Bottom | RectPart.Right],
    ]);
  });

  test("keeps a mixed pair side by side, giving the square the small cell", () => {
    // 'wq' takes neither equal branch, so the asymmetric one. minimalWidth is
    // round(100 * 1.5) = 150, which caps the second cell at 420 - 1 - 150 = 269;
    // the area split wants 268.28, so the wide cell wins 268 and the square
    // keeps 151. Height is round(min(151, 268 / 1.78)) = round(150.56) = 151.
    const layout = albumLayout([
      { w: 1, h: 1 },
      { w: 1.78, h: 1 },
    ]);
    expect(layout.width).toBe(420);
    expect(layout.height).toBe(151);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 151, 151, RectPart.Top | RectPart.Left | RectPart.Bottom],
      [152, 0, 268, 151, RectPart.Top | RectPart.Right | RectPart.Bottom],
    ]);
  });

  test("gives three squares a 66% hero row over two half-width cells", () => {
    // 'qqq' is not 'n'-led, so the top-and-other branch: the hero is
    // round(min(420, (420 - 1) * 0.66)) = round(276.54) = 277, leaving 142 for
    // the two cells, which are (420 - 1) / 2 = 209.5 wide.
    const layout = albumLayout([
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 1, h: 1 },
    ]);
    expect(layout.width).toBe(420);
    expect(layout.height).toBe(420);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 420, 277, RectPart.Left | RectPart.Top | RectPart.Right],
      [0, 278, 209.5, 142, RectPart.Bottom | RectPart.Left],
      [210.5, 278, 209.5, 142, RectPart.Bottom | RectPart.Right],
    ]);
  });

  test("puts four squares in a 60% column beside three stacked cells", () => {
    // 'qqqq' is not 'w'-led, so the left-and-other branch. The column is
    // round(min(420, (420 - 1) * 0.6)) = round(251.4) = 251, the stack is
    // round((420 - 2) / 3) = 139 per cell, and the bottom cell absorbs the two
    // spacings: 420 - 139 - 139 - 2 = 140. The container stops at the stack's
    // right edge, 251 + 1 + 139 = 391 — narrower than maxWidth on purpose.
    const layout = albumLayout([
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 1, h: 1 },
    ]);
    expect(layout.width).toBe(391);
    expect(layout.height).toBe(420);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 251, 420, RectPart.Top | RectPart.Left | RectPart.Bottom],
      [252, 0, 139, 139, RectPart.Top | RectPart.Right],
      [252, 140, 139, 139, RectPart.Right],
      [252, 280, 139, 140, RectPart.Bottom | RectPart.Right],
    ]);
  });

  test("searches row partitions for five items, landing on two rows of 2 and 3", () => {
    // Five items go to ComplexLayouter, which scores every partition against a
    // target height of 420 * 4/3 = 560. For five squares the totals are
    // [2,3] and [3,2] at 349.83, [1,2,2] at 841, [1,1,3] at 981.33 and the
    // four-row partitions at 1472.5; |total - 560| picks [2,3] at 210.17, and
    // no penalty applies (no row under minWidth, counts non-increasing).
    // [1,2,2] would be the pick against a 420 target, so this also pins 560.
    //
    // [2,3] and [3,2] cost exactly the same 210.17, so this is a tie-break and
    // the test is a guard, not a description: the two-row enumeration pushes
    // [2,3] first, and the search keeps the incumbent on `diff < optimalDiff`.
    // Reordering the partition enumeration, or loosening that to `<=`, flips the
    // album to [3,2] — and every other assertion in this file still passes.
    const layout = albumLayout(sq(5));
    expect(layout.width).toBe(420);
    expect(layout.height).toBe(350);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 210, 210, RectPart.Top | RectPart.Left],
      [211, 0, 209, 210, RectPart.Top | RectPart.Right],
      [0, 211, 139, 139, RectPart.Left | RectPart.Bottom],
      [140, 211, 139, 139, RectPart.Bottom],
      [280, 211, 140, 139, RectPart.Right | RectPart.Bottom],
    ]);
  });

  test("routes a ratio over 2 to the complex layouter and measures it against 560", () => {
    // A single 2.5:1 item is enough to leave the hand-written branches, even at
    // four items. cropRatios leaves 2.5 (only wide sets are clamped to 2.75), so
    // multiHeight is (420 - (count - 1)) / (2.5 * count). Four rows of 168 total
    // 675, the closest partition to the 560 target; the three-row [1,2,2] at
    // 337.6 wins instead against a 420 target, and lands at 394. So 591 pins
    // the 4/3 target and the last-column stretch that fills each row to 420.
    const layout = albumLayout(
      Array.from({ length: 5 }, () => ({ w: 2.5, h: 1 })),
    );
    expect(layout.width).toBe(420);
    expect(layout.height).toBe(591);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 420, 168, RectPart.Left | RectPart.Top | RectPart.Right],
      [0, 169, 420, 168, RectPart.Left | RectPart.Right],
      [0, 338, 420, 168, RectPart.Left | RectPart.Right],
      [0, 507, 210, 84, RectPart.Left | RectPart.Bottom],
      [211, 507, 209, 84, RectPart.Right | RectPart.Bottom],
    ]);
  });

  test("rounds each row of a grid separately, so a 3x3 album is 419 tall", () => {
    // Nine squares: 139 per cell per row, and the complex layouter stretches the
    // last *column* to 420 (140 wide) but leaves the last row rounded at 139.
    // The container therefore measures 139 * 3 + 2 spacings = 419, one pixel
    // under the 420 the width reaches.
    const layout = albumLayout(sq(9));
    expect(layout.width).toBe(420);
    expect(layout.height).toBe(419);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 139, 139, RectPart.Top | RectPart.Left],
      [140, 0, 139, 139, RectPart.Top],
      [280, 0, 140, 139, RectPart.Top | RectPart.Right],
      [0, 140, 139, 139, RectPart.Left],
      [140, 140, 139, 139, RectPart.None],
      [280, 140, 140, 139, RectPart.Right],
      [0, 280, 139, 139, RectPart.Left | RectPart.Bottom],
      [140, 280, 139, 139, RectPart.Bottom],
      [280, 280, 140, 139, RectPart.Right | RectPart.Bottom],
    ]);
  });

  test("scales a lone item to maxWidth and keeps its natural height", () => {
    // No maxHeight constraint from albumLayout, so layoutOne returns
    // h * 420 / w untouched: 420 * 3 = 1260 for a 1:3 item.
    const layout = albumLayout([{ w: 1, h: 3 }]);
    expect(layout.width).toBe(420);
    expect(layout.height).toBe(1260);
    expect(layout.items.map(box)).toEqual([
      [
        0,
        0,
        420,
        1260,
        RectPart.Left | RectPart.Top | RectPart.Right | RectPart.Bottom,
      ],
    ]);
  });

  test("reports an empty album as zero size rather than throwing", () => {
    const layout = albumLayout([]);
    expect(layout).toEqual({ width: 0, height: 0, items: [] });
  });

  test("honours maxWidth, minWidth and spacing", () => {
    // Same three squares at 300 wide with 6px gutters: the hero is
    // round(min(300, (300 - 6) * 0.66)) = round(194.04) = 194, the cells are
    // (300 - 6) / 2 = 147, and the container stops at 147 + 6 + 147 = 300.
    const layout = albumLayout(sq(3), { maxWidth: 300, minWidth: 100, spacing: 6 });
    expect(layout.width).toBe(300);
    expect(layout.height).toBe(194 + 6 + 100);
    expect(layout.items.map(box)).toEqual([
      [0, 0, 300, 194, RectPart.Left | RectPart.Top | RectPart.Right],
      [0, 200, 147, 100, RectPart.Bottom | RectPart.Left],
      [153, 200, 147, 100, RectPart.Bottom | RectPart.Right],
    ]);
  });
});

describe("fitInBox", () => {
  test("leaves a media smaller than the box at its natural size", () => {
    expect(fitInBox(300, 200, 420, 400)).toEqual({ w: 300, h: 200 });
  });

  test("scales a wide media down to the box width and keeps the ratio", () => {
    // 1600 / 900 is wider than 420 / 400, so the height is the free side:
    // (900 * 420 / 1600) | 0 = 236.
    expect(fitInBox(1600, 900, 420, 400)).toEqual({ w: 420, h: 236 });
  });

  test("scales a tall media down to the box height and keeps the ratio", () => {
    expect(fitInBox(100, 1000, 420, 400)).toEqual({ w: 40, h: 400 });
  });

  test("covers the box, and upscales, once noZoom is off", () => {
    // noZoom is what keeps a small media small; the 200x200 aspect-cover case in
    // singleMediaBox depends on this branch.
    expect(fitInBox(160, 120, 200, 200, false)).toEqual({ w: 200, h: 150 });
    expect(fitInBox(5, 5, 420, 400, false)).toEqual({ w: 400, h: 400 });
  });

  test("un-rounds a result the truncation left a pixel above the original", () => {
    // (400 * 421 / 400) | 0 = 420 and (400 * 420 / 421) | 0 = 399 would be the
    // fit; the trailing clamp only fires when the rounding overshot both sides.
    expect(fitInBox(421, 400, 420, 400)).toEqual({ w: 420, h: 399 });
    expect(fitInBox(420, 400, 420, 400)).toEqual({ w: 420, h: 400 });
  });
});

describe("singleMediaBox", () => {
  test("lifts a thumbnail to the 200px floor, keeping its own ratio", () => {
    // 160x120 fits inside the 420x400 box untouched, then both sides are under
    // 200, so it is covered into 200x200 at its own ratio: 200x150.
    expect(singleMediaBox({ w: 160, h: 120 }, { hasText: false })).toEqual({
      width: MIN_SIDE_SIZE,
      height: 150,
      fitted: true,
    });
  });

  test("covers a square thumbnail to exactly 200x200", () => {
    expect(singleMediaBox({ w: 100, h: 100 }, { hasText: false })).toEqual({
      width: 200,
      height: 200,
      fitted: true,
    });
  });

  test("widens a narrow media to the text width when the bubble has a caption", () => {
    // 180x800 fits the box as 90x400 — the width is free — and the caption
    // widens it to 320 without touching the height.
    expect(singleMediaBox({ w: 180, h: 800 }, { hasText: true })).toEqual({
      width: EXPAND_TEXT_WIDTH,
      height: 400,
      fitted: false,
    });
  });

  test("widens a narrow media to the minimum photo width when there is no caption", () => {
    expect(singleMediaBox({ w: 180, h: 800 }, { hasText: false })).toEqual({
      width: MIN_IMAGE_WIDTH,
      height: 400,
      fitted: false,
    });
  });

  test("gives a video with a player the wider floor", () => {
    // 720x1280 fits the box as 225x400, which clears both floors for a photo but
    // not the 368px the player needs.
    expect(
      singleMediaBox({ w: 720, h: 1280 }, { hasText: false, isVideo: true }),
    ).toEqual({ width: MIN_VIDEO_SIDE_SIZE, height: 400, fitted: false });
  });

  test("leaves a media that already fills the box alone", () => {
    expect(singleMediaBox({ w: 1600, h: 900 }, { hasText: true })).toEqual({
      width: 420,
      height: 236,
      fitted: true,
    });
  });

  test("accepts a caller-supplied box", () => {
    expect(
      singleMediaBox({ w: 1600, h: 900 }, { hasText: false, box: { w: 320, h: 320 } }),
    ).toEqual({ width: 320, height: 180, fitted: true });
  });
});

describe("purity", () => {
  test("lays out with no DOM in scope", () => {
    // bun test has no `document` and no `window`, so this file's static import of
    // album.ts already proves nothing is read at import time. Trap both globals
    // to prove the layout path does not reach for one either.
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    const trap = (name: "document" | "window") => {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new Error(`album.ts touched ${name}`);
        },
      });
    };
    trap("document");
    trap("window");
    try {
      expect(albumLayout(sq(4)).width).toBe(391);
      expect(singleMediaBox({ w: 160, h: 120 }, { hasText: true }).width).toBe(320);
    } finally {
      Reflect.deleteProperty(globalThis, "document");
      Reflect.deleteProperty(globalThis, "window");
    }
  });
});
