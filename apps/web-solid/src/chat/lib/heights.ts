import type { TimelineItem } from "./grouping"

const TEXT_LINE_HEIGHT = 20
const CHARS_PER_LINE = 96
const ROW_CHROME = 23
const CONTINUATION_ROW_CHROME = 2
const REPLY_QUOTE_ROW = 24
const RUN_END_PADDING = 10
const MIN_ESTIMATE = 60
const CONTINUATION_MIN_ESTIMATE = 28
const DIVIDER_HEIGHT = 36

export const DRIFT_EPSILON = 0.5

function wrappedLineCount(text: string): number {
  let lines = 0
  for (const raw of text.split("\n")) {
    lines += Math.max(1, Math.ceil(raw.length / CHARS_PER_LINE))
  }
  return lines
}

export function estimateRowHeight(
  body: string,
  flags: { isContinuation: boolean; isFollowedByContinuation: boolean; isReply: boolean },
): number {
  let height = flags.isContinuation ? CONTINUATION_ROW_CHROME : ROW_CHROME
  height += wrappedLineCount(body.trim() === "" ? "" : body) * TEXT_LINE_HEIGHT
  if (flags.isReply) height += REPLY_QUOTE_ROW
  height += flags.isFollowedByContinuation ? 0 : RUN_END_PADDING
  return Math.max(
    flags.isContinuation ? CONTINUATION_MIN_ESTIMATE : MIN_ESTIMATE,
    Math.round(height),
  )
}

export function estimateTimelineItemHeight(item: TimelineItem): number {
  return item.kind === "day-divider"
    ? DIVIDER_HEIGHT
    : estimateRowHeight(item.message.body, {
        isContinuation: item.isContinuation,
        isFollowedByContinuation: item.isFollowedByContinuation,
        isReply: item.message.replyToId !== undefined,
      })
}

export function rowReserveStyle(item: TimelineItem): { "contain-intrinsic-size": string } {
  return { "contain-intrinsic-size": `auto ${estimateTimelineItemHeight(item)}px` }
}

export function driftCompensation(drift: number, atBottom: boolean): number {
  if (atBottom || !Number.isFinite(drift)) return 0
  return Math.abs(drift) > DRIFT_EPSILON ? drift : 0
}
