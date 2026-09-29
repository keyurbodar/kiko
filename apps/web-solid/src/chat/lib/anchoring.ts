export const AT_BOTTOM_THRESHOLD_PX = 32

export const TRUE_BOTTOM_THRESHOLD_PX = 1

export const PINNED_CENTER_DRIFT_EPSILON_PX = 0.5

export const SCROLL_OWNER = "create-auto-scroll" as const

export const VIRTUALIZER_ROLE = "virtualization-only" as const

export type MessageDelta = "prepend" | "append" | "replace" | "none"

export type RowRect = {
  readonly messageId: string | undefined
  readonly top: number
  readonly bottom: number
}

export type ContainerTop = {
  readonly top: number
}

export type AnchorState =
  | { readonly kind: "at-bottom" }
  | {
      readonly kind: "message"
      readonly messageId: string
      readonly topOffset: number
    }

export type BottomSettleContainer = Pick<
  HTMLDivElement,
  "scrollHeight" | "clientHeight" | "scrollTop" | "scrollTo"
>

export type ScrollOwnership = {
  readonly scrollOwner: typeof SCROLL_OWNER
  readonly virtualizerRole: typeof VIRTUALIZER_ROLE
}

export const SCROLL_OWNERSHIP: ScrollOwnership = {
  scrollOwner: SCROLL_OWNER,
  virtualizerRole: VIRTUALIZER_ROLE,
}

export type ThreadAnchoring = {
  readonly ownership: ScrollOwnership
  readonly isAtBottom: () => boolean
  readonly userScrolled: () => boolean
  readonly awayFromBottomArrivals: () => number
  readonly resetAwayFromBottomArrivals: () => void
}

export function isAtBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx: number,
): boolean {
  return scrollHeight - clientHeight - scrollTop <= thresholdPx
}

export function computeAnchor(
  container: ContainerTop,
  rows: readonly RowRect[],
): AnchorState {
  for (const row of rows) {
    if (row.bottom <= container.top) continue
    if (!row.messageId) continue
    return {
      kind: "message",
      messageId: row.messageId,
      topOffset: row.top - container.top,
    }
  }
  return { kind: "at-bottom" }
}

export function shouldSettleForVirtualizedBottom({
  isAtBottom: atBottom,
  delta,
  arrived,
  changed,
}: {
  isAtBottom: boolean
  delta: MessageDelta
  arrived: number
  changed: boolean
}): boolean {
  return atBottom && delta !== "prepend" && (arrived > 0 || changed)
}

export function settleProgrammaticBottomPin(
  container: BottomSettleContainer,
): boolean {
  container.scrollTo({ top: container.scrollHeight, behavior: "auto" })
  return (
    container.scrollHeight - container.clientHeight - container.scrollTop <=
    TRUE_BOTTOM_THRESHOLD_PX
  )
}

export function getPinnedCenterDrift({
  contentTop,
  currentContentTop,
}: {
  contentTop: number
  currentContentTop: number
}): number | null {
  const drift = currentContentTop - contentTop
  return Math.abs(drift) > PINNED_CENTER_DRIFT_EPSILON_PX ? drift : null
}
