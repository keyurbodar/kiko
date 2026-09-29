import { describe, expect, test } from "bun:test";
import {
  SKELETON_HEADER_PX,
  SKELETON_LINE_HEIGHT_PX,
  SKELETON_ROW_PADDING_PX,
  SKELETON_RUN_GAP_PX,
  skeletonRowHeight,
  skeletonRunGapPx,
  skeletonRunHeight,
  skeletonTimelineHeight,
  type SkeletonRowShape,
} from "./skeletonGeometry";

const row = (
  lineCount: number,
  isRunStart: boolean,
): SkeletonRowShape => ({ lineCount, isRunStart });

describe("skeleton constants mirror chat.css", () => {
  test("the constants are the px values the real row uses", () => {
    expect(SKELETON_LINE_HEIGHT_PX).toBe(22);
    expect(SKELETON_HEADER_PX).toBe(22);
    expect(SKELETON_ROW_PADDING_PX).toBe(2);
    expect(SKELETON_RUN_GAP_PX).toBe(21);
  });
});

describe("skeletonRowHeight", () => {
  test("a run start carries the header, a continuation does not", () => {
    expect(skeletonRowHeight(1, true)).toBe(
      SKELETON_ROW_PADDING_PX * 2 + SKELETON_HEADER_PX + SKELETON_LINE_HEIGHT_PX,
    );
    expect(skeletonRowHeight(1, false)).toBe(
      SKELETON_ROW_PADDING_PX * 2 + SKELETON_LINE_HEIGHT_PX,
    );
    expect(skeletonRowHeight(1, false)).toBe(26);
    expect(skeletonRowHeight(1, true)).toBe(48);
  });

  test("line count drives height by exactly one line height per line", () => {
    expect(skeletonRowHeight(3, true) - skeletonRowHeight(1, true)).toBe(
      2 * SKELETON_LINE_HEIGHT_PX,
    );
    expect(skeletonRowHeight(3, true)).toBe(92);
    expect(skeletonRowHeight(4, false)).toBe(SKELETON_ROW_PADDING_PX * 2 + 4 * 22);
  });

  test("a single-line non-run row is shorter than a run-start row", () => {
    expect(skeletonRowHeight(1, false)).toBeLessThan(skeletonRowHeight(1, true));
    expect(skeletonRowHeight(1, true) - skeletonRowHeight(1, false)).toBe(
      SKELETON_HEADER_PX,
    );
  });
});

describe("run gap", () => {
  test("the gap replaces the padding a run-end row already had", () => {
    expect(skeletonRunGapPx()).toBe(SKELETON_RUN_GAP_PX - SKELETON_ROW_PADDING_PX);
    expect(skeletonRunGapPx()).toBe(19);
  });

  test("a run of three rows adds the gap once, not once per row", () => {
    const run = [row(1, true), row(1, false), row(1, false)];
    const rowsOnly = run.reduce(
      (total, shape) => total + skeletonRowHeight(shape.lineCount, shape.isRunStart),
      0,
    );
    expect(skeletonRunHeight(run)).toBe(rowsOnly + skeletonRunGapPx());
    expect(skeletonRunHeight(run)).toBe(rowsOnly + 19);
    expect(skeletonRunHeight(run)).toBe(119);
  });

  test("a two-row run is shorter than the two one-row runs that replace it", () => {
    const oneRun = skeletonRunHeight([row(1, true), row(1, false)]);
    const twoRuns = skeletonRunHeight([row(1, true)]) + skeletonRunHeight([row(1, true)]);
    expect(twoRuns).toBe(2 * (skeletonRowHeight(1, true) + skeletonRunGapPx()));
    expect(twoRuns).toBe(134);
    expect(oneRun).toBe(93);
  });

  test("an empty run has no height", () => {
    expect(skeletonRunHeight([])).toBe(0);
  });
});

describe("skeletonTimelineHeight", () => {
  test("sums row heights and applies the gap only at run boundaries", () => {
    const rows = [row(2, true), row(1, false), row(1, true), row(1, true)];
    const expected =
      skeletonRowHeight(2, true) +
      skeletonRowHeight(1, false) +
      skeletonRunGapPx() +
      skeletonRowHeight(1, true) +
      skeletonRunGapPx() +
      skeletonRowHeight(1, true) +
      skeletonRunGapPx();
    expect(skeletonTimelineHeight(rows)).toBe(expected);
  });

  test("the row count alone does not change the total", () => {
    const manyRows: SkeletonRowShape[] = Array.from({ length: 20 }, () => row(1, true));
    expect(skeletonTimelineHeight(manyRows)).toBe(
      20 * (skeletonRowHeight(1, true) + skeletonRunGapPx()),
    );
  });

  test("an empty timeline has no height", () => {
    expect(skeletonTimelineHeight([])).toBe(0);
  });
});
