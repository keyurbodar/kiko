import type { TimelineItem } from "./grouping"

export const SKELETON_HEADER_PX = 22
export const SKELETON_FONT_SIZE_PX = 15
export const SKELETON_LINE_HEIGHT_PX = 22
export const SKELETON_ROW_PADDING_PX = 4
export const SKELETON_RUN_GAP_PX = 21
export const SKELETON_CHARS_PER_LINE = 91
export const SKELETON_MAX_LINES = 4

export type SkeletonRowShape = {
  readonly lineCount: number
  readonly isRunStart: boolean
}

export function skeletonLineCount(body: string): number {
  const text = body.replace(/\s+/g, " ").trim()
  if (text.length === 0) return 1
  return Math.min(
    SKELETON_MAX_LINES,
    Math.max(1, Math.ceil(text.length / SKELETON_CHARS_PER_LINE)),
  )
}

export function skeletonRowsFromItems(items: readonly TimelineItem[]): SkeletonRowShape[] {
  return items.flatMap((item) =>
    item.kind === "message"
      ? [{ lineCount: skeletonLineCount(item.message.body), isRunStart: !item.isContinuation }]
      : [],
  )
}

export function skeletonRowHeight(lineCount: number, isRunStart: boolean): number {
  const header = isRunStart ? SKELETON_HEADER_PX : 0
  const lines = Math.max(1, Math.round(lineCount)) * SKELETON_LINE_HEIGHT_PX
  return SKELETON_ROW_PADDING_PX * 2 + header + lines
}

export function skeletonRunGapPx(): number {
  return SKELETON_RUN_GAP_PX - SKELETON_ROW_PADDING_PX
}

export function skeletonRowOuterHeight(
  lineCount: number,
  isRunStart: boolean,
  isRunEnd: boolean,
): number {
  const height = skeletonRowHeight(lineCount, isRunStart)
  return isRunEnd ? height + skeletonRunGapPx() : height
}

export function skeletonRunHeight(run: readonly SkeletonRowShape[]): number {
  let total = 0
  for (let i = 0; i < run.length; i += 1) {
    const row = run[i]
    total += skeletonRowOuterHeight(row.lineCount, row.isRunStart, i === run.length - 1)
  }
  return total
}

export function skeletonTimelineHeight(rows: readonly SkeletonRowShape[]): number {
  let total = 0
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const isRunEnd = rows[i + 1]?.isRunStart ?? true
    total += skeletonRowOuterHeight(row.lineCount, row.isRunStart, isRunEnd)
  }
  return total
}
