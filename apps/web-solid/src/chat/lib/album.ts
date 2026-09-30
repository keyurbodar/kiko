/**
 * Album geometry — a pure port of tweb's `groupedLayout.ts` (the `Layouter` and
 * `ComplexLayouter` classes), `prepareAlbum.ts`'s container derivation,
 * `calcImageInBox.ts` and the `setAttachmentSize.ts` clamp ladder.
 *
 * The arithmetic below is a transcription, not a re-derivation. Every
 * `Math.round`, every `0.66`/`0.6`/`0.4`/`0.33` factor and every `| 0` truncation
 * is where tweb has it, because the rounding is what makes a two-up album's
 * cells 209.5px and land back on 420px of container. Touch a number here and
 * the album stops matching every album tweb has ever shipped.
 *
 * Nothing in this file touches `document`, `window` or Solid: it takes numbers
 * and returns numbers. The DOM half of `prepareAlbum` (percent positioning and
 * per-corner radius clamping) lives with the components.
 *
 * Callers position items by converting the returned px rects to percentages of
 * `width`/`height`:
 *
 *     style.left   = (rect.x + rect.width / 2) / layout.width * 100 + '%'
 *
 * Percentage positioning is what makes the layout resolution-independent — the
 * same numbers render at any container size, and the browser's subpixel layout
 * fills the sub-pixel gap `Math.round` left behind.
 */

export interface MediaSize {
  w: number;
  h: number;
}

export interface AlbumRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Bitmask of the rect's edges on the album's outline. tweb uses it to round
   * only the outer corners (a 3x3 album has 12 rounded corners, not 36).
   */
  sides: number;
}

export interface AlbumLayout {
  width: number;
  height: number;
  items: AlbumRect[];
}

/**
 * Album edge bitmask. Matches tweb's `RectPart` and tdesktop's `GroupMediaLayout`
 * part flags.
 */
export const RectPart = {
  None: 0,
  Top: 1,
  Right: 2,
  Bottom: 4,
  Left: 8,
};

/** tweb's `mediaSizes.regular` — the box a lone photo or video is fitted into. */
export const REGULAR_BOX: MediaSize = { w: 420, h: 400 };

/** Below this the bubble is unreadable next to a full-bleed photo, so widen. */
export const EXPAND_TEXT_WIDTH = 320;
/** A photo narrower than this renders as a useless sliver. */
export const MIN_IMAGE_WIDTH = 120;
/** Both sides under this is a thumbnail, not a photo. */
export const MIN_SIDE_SIZE = 200;
/** The video player needs this much width for its controls to be operable. */
export const MIN_VIDEO_SIDE_SIZE = 368;

const DEFAULT_MAX_WIDTH = 420;
const DEFAULT_MIN_WIDTH = 100;
const DEFAULT_SPACING = 1;

/** tweb's `@helpers/array/accumulate`; kept so the cost sums read identically. */
function accumulate(values: readonly number[], initialValue: number): number {
  return values.reduce((acc, value) => acc + value, initialValue);
}



/**
 * `calcImageInBox` — fit a media size inside a box, preserving its aspect ratio.
 *
 * `noZoom` (tweb's default) means "never upscale": a media smaller than the box
 * is returned at its natural size, and the trailing clamp undoes any rounding
 * that left the result a pixel or two larger than the original.
 */
export function fitInBox(
  imageW: number,
  imageH: number,
  boxW: number,
  boxH: number,
  noZoom = true,
): MediaSize {
  if (imageW < boxW && imageH < boxH && noZoom) {
    return { w: imageW, h: imageH };
  }

  let boxedImageW = boxW;
  let boxedImageH = boxH;

  if (imageW / imageH > boxW / boxH) {
    boxedImageH = (imageH * boxW / imageW) | 0;
  } else {
    boxedImageW = (imageW * boxH / imageH) | 0;
    if (boxedImageW > boxW) {
      boxedImageH = (boxedImageH * boxW / boxedImageW) | 0;
      boxedImageW = boxW;
    }
  }

  if (noZoom && boxedImageW >= imageW && boxedImageH >= imageH) {
    boxedImageW = imageW;
    boxedImageH = imageH;
  }

  return { w: boxedImageW, h: boxedImageH };
}

/**
 * The `setAttachmentSize` clamp ladder for one standalone photo or video.
 *
 * tweb mutates a `<div>` here; this returns the px box the caller should hand to
 * one. The ladder is fit -> 200px floor -> text widening -> minimum width, and
 * each step feeds the next off the *already fitted* size, not the original — so
 * a 160x120 thumbnail is covered up into 200x150, not 200x200.
 *
 * `fitted` is false once any step widened the box, which means the media is
 * letterboxed inside it. (tweb tracks the same fact in `isFit`, but only clears
 * it on the last step; here every widen clears it, because the only question a
 * caller asks is "does the media fill the box".)
 *
 * Documents never reach this function — `MediaItem` is photo or video — so the
 * 200px floor always applies. `isVideo` is tweb's `canHaveVideoPlayer`: a video
 * rendered with the player chrome, which needs more room than a bare photo.
 */
export function singleMediaBox(
  size: MediaSize,
  opts: { hasText: boolean; isVideo?: boolean; box?: MediaSize },
): { width: number; height: number; fitted: boolean } {
  const box = opts.box ?? REGULAR_BOX;
  let boxSize = fitInBox(size.w, size.h, box.w, box.h, true);
  let fitted = true;

  if (boxSize.w < MIN_SIDE_SIZE && boxSize.h < MIN_SIDE_SIZE) {
    // aspectCovered: cover the 200x200 floor with the media's own ratio.
    boxSize = fitInBox(boxSize.w, boxSize.h, MIN_SIDE_SIZE, MIN_SIDE_SIZE, false);
  }

  if (opts.hasText && boxSize.w < EXPAND_TEXT_WIDTH) {
    boxSize = { w: EXPAND_TEXT_WIDTH, h: boxSize.h };
    fitted = false;
  }

  const minWidth = opts.isVideo ? MIN_VIDEO_SIDE_SIZE : MIN_IMAGE_WIDTH;
  if (boxSize.w < minWidth) {
    boxSize = { w: minWidth, h: boxSize.h };
    fitted = false;
  }

  return { width: boxSize.w, height: boxSize.h, fitted };
}

/**
 * Lay an album out, and report the container it needs.
 *
 * `maxHeight` is deliberately not an option: tweb lets the caller constrain the
 * album's height, and every caller here renders the album at its natural height.
 * Leaving it unset is what makes the complex layouter aim for `maxWidth * 4/3`
 * (see `ComplexLayouter`) instead of `maxWidth`.
 *
 * Albums run to ten items, and the complex layouter tops out at twelve (four
 * rows of at most three) — tweb has the same ceiling, and the same throw past
 * it, so a caller must not hand this more than an album's worth of media.
 */
export function albumLayout(
  sizes: readonly MediaSize[],
  opts: { maxWidth?: number; minWidth?: number; spacing?: number } = {},
): AlbumLayout {
  const maxWidth = opts.maxWidth ?? DEFAULT_MAX_WIDTH;
  const minWidth = opts.minWidth ?? DEFAULT_MIN_WIDTH;
  const spacing = opts.spacing ?? DEFAULT_SPACING;

  const layout = new Layouter(sizes, maxWidth, minWidth, spacing).layout();
  if (!layout.length) return { width: 0, height: 0, items: [] };

  // `prepareAlbum` reads the container off the rects that reach the right and the
  // bottom edge, so a layout that under-fills its own max width reports that.
  const widthItem = layout.find((item) => item.sides & RectPart.Right);
  const width = widthItem ? widthItem.x + widthItem.width : 0;
  const heightItem = layout.find((item) => item.sides & RectPart.Bottom);
  const height = heightItem ? heightItem.y + heightItem.height : 0;

  return { width, height, items: layout };
}

/**
 * tdesktop's `ui/grouped_layout.cpp`, as tweb transcribed it. Up to four items
 * get a hand-written branch per shape; five or more — or any single item more
 * than twice as wide as it is tall — fall through to `ComplexLayouter`, which
 * searches row partitions instead.
 */
class Layouter {
  private count: number;
  private ratios: number[];
  private proportions: string;
  private averageRatio: number;
  private maxSizeRatio: number;
  private maxHeight: number;
  private maxHeightConstraint?: number;

  constructor(
    private sizes: readonly MediaSize[],
    private maxWidth: number,
    private minWidth: number,
    private spacing: number,
    maxHeight?: number,
  ) {
    this.maxHeight = maxHeight ?? maxWidth;
    this.maxHeightConstraint = maxHeight;
    this.count = sizes.length;
    this.ratios = Layouter.countRatios(sizes);
    this.proportions = Layouter.countProportions(this.ratios);
    this.averageRatio = accumulate(this.ratios, 1) / this.count;
    this.maxSizeRatio = maxWidth / this.maxHeight;
  }

  public layout(): AlbumRect[] {
    if (!this.count) return [];
    else if (this.count === 1) return this.layoutOne();

    if (this.count >= 5 || this.ratios.find((r) => r > 2)) {
      return new ComplexLayouter(
        this.ratios,
        this.averageRatio,
        this.maxWidth,
        this.minWidth,
        this.spacing,
        this.maxHeightConstraint,
      ).layout();
    }

    if (this.count === 2) return this.layoutTwo();
    else if (this.count === 3) return this.layoutThree();
    return this.layoutFour();
  }

  private layoutTwo(): AlbumRect[] {
    if (
      this.proportions === "ww" &&
      this.averageRatio > 1.4 * this.maxSizeRatio &&
      this.ratios[1] - this.ratios[0] < 0.2
    ) {
      return this.layoutTwoTopBottom();
    } else if (this.proportions === "ww" || this.proportions === "qq") {
      return this.layoutTwoLeftRightEqual();
    }
    return this.layoutTwoLeftRight();
  }

  private layoutThree(): AlbumRect[] {
    if (this.proportions[0] === "n") {
      return this.layoutThreeLeftAndOther();
    }
    return this.layoutThreeTopAndOther();
  }

  private layoutFour(): AlbumRect[] {
    if (this.proportions[0] === "w") {
      return this.layoutFourTopAndOther();
    }
    return this.layoutFourLeftAndOther();
  }

  private layoutOne(): AlbumRect[] {
    const width = this.maxWidth;
    const naturalHeight = (this.sizes[0].h * width) / this.sizes[0].w;
    const height =
      this.maxHeightConstraint === undefined
        ? naturalHeight
        : Math.min(naturalHeight, this.maxHeight);

    return [
      {
        x: 0,
        y: 0,
        width,
        height,
        sides: RectPart.Left | RectPart.Top | RectPart.Right | RectPart.Bottom,
      },
    ];
  }

  private layoutTwoTopBottom(): AlbumRect[] {
    const width = this.maxWidth;
    const height = Math.round(
      Math.min(
        width / this.ratios[0],
        Math.min(width / this.ratios[1], (this.maxHeight - this.spacing) / 2),
      ),
    );

    return [
      {
        x: 0,
        y: 0,
        width,
        height,
        sides: RectPart.Left | RectPart.Top | RectPart.Right,
      },
      {
        x: 0,
        y: height + this.spacing,
        width,
        height,
        sides: RectPart.Left | RectPart.Bottom | RectPart.Right,
      },
    ];
  }

  private layoutTwoLeftRightEqual(): AlbumRect[] {
    const width = (this.maxWidth - this.spacing) / 2;
    const height = Math.round(
      Math.min(
        width / this.ratios[0],
        Math.min(width / this.ratios[1], this.maxHeight * 1),
      ),
    );

    return [
      {
        x: 0,
        y: 0,
        width,
        height,
        sides: RectPart.Top | RectPart.Left | RectPart.Bottom,
      },
      {
        x: width + this.spacing,
        y: 0,
        width,
        height,
        sides: RectPart.Top | RectPart.Right | RectPart.Bottom,
      },
    ];
  }

  private layoutTwoLeftRight(): AlbumRect[] {
    const minimalWidth = Math.round(this.minWidth * 1.5);
    const secondWidth = Math.min(
      Math.round(
        Math.max(
          0.4 * (this.maxWidth - this.spacing),
          (this.maxWidth - this.spacing) /
            this.ratios[0] /
            (1 / this.ratios[0] + 1 / this.ratios[1]),
        ),
      ),
      this.maxWidth - this.spacing - minimalWidth,
    );
    const firstWidth = this.maxWidth - secondWidth - this.spacing;
    const height = Math.min(
      this.maxHeight,
      Math.round(Math.min(firstWidth / this.ratios[0], secondWidth / this.ratios[1])),
    );

    return [
      {
        x: 0,
        y: 0,
        width: firstWidth,
        height,
        sides: RectPart.Top | RectPart.Left | RectPart.Bottom,
      },
      {
        x: firstWidth + this.spacing,
        y: 0,
        width: secondWidth,
        height,
        sides: RectPart.Top | RectPart.Right | RectPart.Bottom,
      },
    ];
  }

  private layoutThreeLeftAndOther(): AlbumRect[] {
    const firstHeight = this.maxHeight;
    const thirdHeight = Math.round(
      Math.min(
        (this.maxHeight - this.spacing) / 2.0,
        (this.ratios[1] * (this.maxWidth - this.spacing)) /
          (this.ratios[2] + this.ratios[1]),
      ),
    );
    const secondHeight = firstHeight - thirdHeight - this.spacing;
    const rightWidth = Math.max(
      this.minWidth,
      Math.round(
        Math.min(
          (this.maxWidth - this.spacing) / 2.0,
          Math.min(thirdHeight * this.ratios[2], secondHeight * this.ratios[1]),
        ),
      ),
    );
    const leftWidth = Math.min(
      Math.round(firstHeight * this.ratios[0]),
      this.maxWidth - this.spacing - rightWidth,
    );

    return [
      {
        x: 0,
        y: 0,
        width: leftWidth,
        height: firstHeight,
        sides: RectPart.Top | RectPart.Left | RectPart.Bottom,
      },
      {
        x: leftWidth + this.spacing,
        y: 0,
        width: rightWidth,
        height: secondHeight,
        sides: RectPart.Top | RectPart.Right,
      },
      {
        x: leftWidth + this.spacing,
        y: secondHeight + this.spacing,
        width: rightWidth,
        height: thirdHeight,
        sides: RectPart.Bottom | RectPart.Right,
      },
    ];
  }

  private layoutThreeTopAndOther(): AlbumRect[] {
    const firstWidth = this.maxWidth;
    const firstHeight = Math.round(
      Math.min(firstWidth / this.ratios[0], (this.maxHeight - this.spacing) * 0.66),
    );
    const secondWidth = (this.maxWidth - this.spacing) / 2;
    const secondHeight = Math.min(
      this.maxHeight - firstHeight - this.spacing,
      Math.round(Math.min(secondWidth / this.ratios[1], secondWidth / this.ratios[2])),
    );
    const thirdWidth = firstWidth - secondWidth - this.spacing;

    return [
      {
        x: 0,
        y: 0,
        width: firstWidth,
        height: firstHeight,
        sides: RectPart.Left | RectPart.Top | RectPart.Right,
      },
      {
        x: 0,
        y: firstHeight + this.spacing,
        width: secondWidth,
        height: secondHeight,
        sides: RectPart.Bottom | RectPart.Left,
      },
      {
        x: secondWidth + this.spacing,
        y: firstHeight + this.spacing,
        width: thirdWidth,
        height: secondHeight,
        sides: RectPart.Bottom | RectPart.Right,
      },
    ];
  }

  private layoutFourTopAndOther(): AlbumRect[] {
    const w = this.maxWidth;
    const h0 = Math.round(
      Math.min(w / this.ratios[0], (this.maxHeight - this.spacing) * 0.66),
    );
    const h = Math.round(
      (this.maxWidth - 2 * this.spacing) /
        (this.ratios[1] + this.ratios[2] + this.ratios[3]),
    );
    const w0 = Math.max(
      this.minWidth,
      Math.round(Math.min((this.maxWidth - 2 * this.spacing) * 0.4, h * this.ratios[1])),
    );
    const w2 = Math.round(
      Math.max(
        Math.max(this.minWidth * 1.0, (this.maxWidth - 2 * this.spacing) * 0.33),
        h * this.ratios[3],
      ),
    );
    const w1 = w - w0 - w2 - 2 * this.spacing;
    const h1 = Math.min(this.maxHeight - h0 - this.spacing, h);

    return [
      {
        x: 0,
        y: 0,
        width: w,
        height: h0,
        sides: RectPart.Left | RectPart.Top | RectPart.Right,
      },
      {
        x: 0,
        y: h0 + this.spacing,
        width: w0,
        height: h1,
        sides: RectPart.Bottom | RectPart.Left,
      },
      {
        x: w0 + this.spacing,
        y: h0 + this.spacing,
        width: w1,
        height: h1,
        sides: RectPart.Bottom,
      },
      {
        x: w0 + this.spacing + w1 + this.spacing,
        y: h0 + this.spacing,
        width: w2,
        height: h1,
        sides: RectPart.Right | RectPart.Bottom,
      },
    ];
  }

  private layoutFourLeftAndOther(): AlbumRect[] {
    const h = this.maxHeight;
    const w0 = Math.round(
      Math.min(h * this.ratios[0], (this.maxWidth - this.spacing) * 0.6),
    );

    const w = Math.round(
      (this.maxHeight - 2 * this.spacing) /
        (1.0 / this.ratios[1] + 1.0 / this.ratios[2] + 1.0 / this.ratios[3]),
    );
    const h0 = Math.round(w / this.ratios[1]);
    const h1 = Math.round(w / this.ratios[2]);
    const h2 = h - h0 - h1 - 2 * this.spacing;
    const w1 = Math.max(
      this.minWidth,
      Math.min(this.maxWidth - w0 - this.spacing, w),
    );

    return [
      {
        x: 0,
        y: 0,
        width: w0,
        height: h,
        sides: RectPart.Top | RectPart.Left | RectPart.Bottom,
      },
      {
        x: w0 + this.spacing,
        y: 0,
        width: w1,
        height: h0,
        sides: RectPart.Top | RectPart.Right,
      },
      {
        x: w0 + this.spacing,
        y: h0 + this.spacing,
        width: w1,
        height: h1,
        sides: RectPart.Right,
      },
      {
        x: w0 + this.spacing,
        y: h0 + h1 + 2 * this.spacing,
        width: w1,
        height: h2,
        sides: RectPart.Bottom | RectPart.Right,
      },
    ];
  }

  private static countRatios(sizes: readonly MediaSize[]): number[] {
    return sizes.map((size) => size.w / size.h);
  }

  private static countProportions(ratios: number[]): string {
    return ratios
      .map((ratio) => (ratio > 1.2 ? "w" : ratio < 0.8 ? "n" : "q"))
      .join("");
  }
}

interface Attempt {
  lineCounts: number[];
  heights: number[];
}

/**
 * Five or more items, or any single item more than twice as wide as it is tall:
 * too many shapes for a hand-written branch, so the layouter enumerates row
 * partitions and scores them against a target height.
 *
 * The target is `maxHeight * 4/3` when the caller did not constrain the height,
 * which is why a 5-up square album runs two rows deep rather than stacking five.
 */
class ComplexLayouter {
  private ratios: number[];
  private count: number;
  private maxHeight: number;
  private constrainHeight: boolean;

  constructor(
    ratios: number[],
    private averageRatio: number,
    private maxWidth: number,
    private minWidth: number,
    private spacing: number,
    maxHeight?: number,
  ) {
    this.ratios = ComplexLayouter.cropRatios(ratios, averageRatio);
    this.count = ratios.length;
    this.maxHeight = maxHeight ?? (maxWidth * 4) / 3;
    this.constrainHeight = maxHeight !== undefined;
  }

  /**
   * A 5-up album with one panorama in it should not degenerate into a column of
   * letterboxed slivers, so the ratios are clamped toward 1 before the search —
   * hard: a wide set is flattened to at most 2.75:1, a tall set to at most
   * 1:0.6667.
   */
  private static cropRatios(ratios: number[], averageRatio: number): number[] {
    const kMaxRatio = 2.75;
    const kMinRatio = 0.6667;
    // tweb's clamp() is Math.min(max, Math.max(min, ratio)).
    return ratios.map((ratio) => {
      return averageRatio > 1.1
        ? Math.min(kMaxRatio, Math.max(1.0, ratio))
        : Math.min(1.0, Math.max(kMinRatio, ratio));
    });
  }

  public layout(): AlbumRect[] {
    const result = new Array<AlbumRect>(this.count);

    const attempts: Attempt[] = [];
    const multiHeight = (offset: number, count: number) => {
      const ratios = this.ratios.slice(offset, offset + count);
      const sum = accumulate(ratios, 0);
      return (this.maxWidth - (count - 1) * this.spacing) / sum;
    };
    const pushAttempt = (lineCounts: number[]) => {
      const heights: number[] = [];
      let offset = 0;
      for (const count of lineCounts) {
        heights.push(multiHeight(offset, count));
        offset += count;
      }
      attempts.push({ lineCounts, heights });
    };

    for (let first = 1; first !== this.count; ++first) {
      const second = this.count - first;
      if (first > 3 || second > 3) {
        continue;
      }
      pushAttempt([first, second]);
    }
    for (let first = 1; first !== this.count - 1; ++first) {
      for (let second = 1; second !== this.count - first; ++second) {
        const third = this.count - first - second;
        if (
          first > 3 ||
          second > (this.averageRatio < 0.85 ? 4 : 3) ||
          third > 3
        ) {
          continue;
        }
        pushAttempt([first, second, third]);
      }
    }
    for (let first = 1; first !== this.count - 1; ++first) {
      for (let second = 1; second !== this.count - first; ++second) {
        for (let third = 1; third !== this.count - first - second; ++third) {
          const fourth = this.count - first - second - third;
          if (first > 3 || second > 3 || third > 3 || fourth > 3) {
            continue;
          }
          pushAttempt([first, second, third, fourth]);
        }
      }
    }

    let optimalAttempt: Attempt | null = null;
    let optimalDiff = 0;
    for (const attempt of attempts) {
      const { heights, lineCounts: counts } = attempt;
      const lineCount = counts.length;
      const totalHeight = accumulate(heights, 0) + this.spacing * (lineCount - 1);
      const minLineHeight = Math.min(...heights);
      // A row shorter than minWidth is a strip of thumbnails; a row wider than
      // the one above it is a step in the wrong direction. Both are 50% worse.
      const bad1 = minLineHeight < this.minWidth ? 1.5 : 1;
      const bad2 = (() => {
        for (let line = 1; line !== lineCount; ++line) {
          if (counts[line - 1] > counts[line]) {
            return 1.5;
          }
        }
        return 1.0;
      })();
      const diff = Math.abs(totalHeight - this.maxHeight) * bad1 * bad2;
      if (!optimalAttempt || diff < optimalDiff) {
        optimalAttempt = attempt;
        optimalDiff = diff;
      }
    }

    // The first candidate always wins, so this is set whenever the partition
    // search produced anything — tweb reads it unconditionally here too, and
    // throws on an album too large to split into rows of at most three.
    const optimalCounts = optimalAttempt!.lineCounts;
    const optimalHeights = optimalAttempt!.heights;
    const rowCount = optimalCounts.length;
    const naturalHeight =
      accumulate(optimalHeights, 0) + this.spacing * (rowCount - 1);
    const heightScale =
      this.constrainHeight && naturalHeight > this.maxHeight
        ? Math.max(0, this.maxHeight - this.spacing * (rowCount - 1)) /
          accumulate(optimalHeights, 0)
        : 1;
    let accumulatedScaledHeight = 0;
    const scaledHeights = optimalHeights.map((height, row) => {
      let scaledHeight: number;
      if (heightScale === 1) {
        scaledHeight = Math.round(height);
      } else if (row !== rowCount - 1) {
        scaledHeight = Math.floor(height * heightScale);
      } else {
        // The last row absorbs the rounding, so the album hits its height exactly.
        scaledHeight = Math.max(
          0,
          this.maxHeight -
            this.spacing * (rowCount - 1) -
            accumulatedScaledHeight,
        );
      }
      accumulatedScaledHeight += scaledHeight;
      return scaledHeight;
    });

    let index = 0;
    let y = 0;
    for (let row = 0; row !== rowCount; ++row) {
      const colCount = optimalCounts[row];
      const lineHeight = optimalHeights[row];
      const height = scaledHeights[row];

      let x = 0;
      for (let col = 0; col !== colCount; ++col) {
        const sides =
          RectPart.None |
          (row === 0 ? RectPart.Top : RectPart.None) |
          (row === rowCount - 1 ? RectPart.Bottom : RectPart.None) |
          (col === 0 ? RectPart.Left : RectPart.None) |
          (col === colCount - 1 ? RectPart.Right : RectPart.None);

        const ratio = this.ratios[index];
        // The last column is stretched rather than rounded: per-row rounding
        // would leave every row a fraction of a pixel short of maxWidth.
        const width =
          col === colCount - 1 ? this.maxWidth - x : Math.round(ratio * lineHeight);
        result[index] = {
          x,
          y,
          width,
          height,
          sides,
        };

        x += width + this.spacing;
        ++index;
      }
      y += height + this.spacing;
    }

    return result;
  }
}
