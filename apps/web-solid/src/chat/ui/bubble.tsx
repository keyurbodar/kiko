import {
  type ComponentProps,
  type JSX,
  mergeProps,
  splitProps,
  type ValidComponent,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { cn } from "../../lib/cn"

/**
 * The bubble primitives, ported from zaidan's bubble section.
 *
 * The structure is the point, and it is the thing we did not have: `Bubble` is
 * the positioned parent and does NOT clip, `BubbleContent` owns both the paint
 * and the `overflow-hidden` that keeps a long word inside the radius, and
 * `BubbleReactions` is a SIBLING of the content rather than a descendant of it.
 * That last part is what lets a badge hang over the bubble's edge without the
 * radius slicing it in half.
 *
 * Every size, colour and radius below is a Tailwind utility bound to a kat
 * role, so there is no second stylesheet to keep in sync: a token change moves
 * the bubble with it. Our density is the padding and the type step - `px-3
 * py-[7px]` and `text-base` are the 7/12px and 14px the transcript is set in.
 *
 * The element contracts are the `data-slot` values and the `data-variant` /
 * `data-align` / `data-side` attributes, so a caller restyles a part by
 * overriding a utility through `class` rather than by fighting a stylesheet.
 */

export type BubbleVariant =
  | "default"
  | "secondary"
  | "muted"
  | "tinted"
  | "outline"
  | "ghost"
  | "destructive"

export type BubbleAlign = "start" | "end"

type BubbleGroupProps = ComponentProps<"div">

/** Consecutive bubbles from one sender, set closer together than two runs. */
export function BubbleGroup(props: BubbleGroupProps) {
  const [local, others] = splitProps(props, ["class"])
  return <div data-slot="bubble-group" class={cn("flex min-w-0 flex-col gap-2", local.class)} {...others} />
}

export type BubblePosition = "only" | "first" | "middle" | "last"

export type BubbleProps = ComponentProps<"div"> & {
  variant?: BubbleVariant
  align?: BubbleAlign
  position?: BubblePosition
}

const SENDER_CORNERS =
  "data-[align=start]:data-[position=first]:[&>[data-slot=bubble-content]]:rounded-es-bubble-tight " +
  "data-[align=start]:data-[position=middle]:[&>[data-slot=bubble-content]]:rounded-ss-bubble-tight " +
  "data-[align=start]:data-[position=middle]:[&>[data-slot=bubble-content]]:rounded-es-bubble-tight " +
  "data-[align=start]:data-[position=last]:[&>[data-slot=bubble-content]]:rounded-ss-bubble-tight " +
  "data-[align=end]:data-[position=first]:[&>[data-slot=bubble-content]]:rounded-ee-bubble-tight " +
  "data-[align=end]:data-[position=middle]:[&>[data-slot=bubble-content]]:rounded-se-bubble-tight " +
  "data-[align=end]:data-[position=middle]:[&>[data-slot=bubble-content]]:rounded-ee-bubble-tight " +
  "data-[align=end]:data-[position=last]:[&>[data-slot=bubble-content]]:rounded-se-bubble-tight"

/**
 * The positioned, unclipped parent of one bubble's contents.
 *
 * `data-align="end"` is what places the bubble in a column-stacked row, and
 * `max-w-[80%]` is the transcript's width cap.
 */
export function Bubble(rawProps: BubbleProps) {
  const props = mergeProps(
    {
      variant: "default" as BubbleVariant,
      align: "start" as BubbleAlign,
      position: "only" as BubblePosition,
    },
    rawProps,
  )
  const [local, others] = splitProps(props, ["align", "class", "variant", "position"])
  return (
    <div
      data-slot="bubble"
      data-variant={local.variant}
      data-align={local.align}
      data-position={local.position}
      class={cn(
        "relative flex w-fit min-w-0 max-w-[80%] flex-col gap-1",
        "data-[align=end]:self-end data-[variant=ghost]:max-w-full",
        VARIANTS[local.variant],
        local.variant !== "ghost" && SENDER_CORNERS,
        local.class,
      )}
      {...others}
    />
  )
}

/**
 * A variant paints the content, not the box, so the reaction badge that hangs
 * off the box is never inside the fill. Written as a child selector on the
 * parent because the variant is the parent's data attribute.
 */
const VARIANTS: Record<BubbleVariant, string> = {
  default:
    "[&>[data-slot=bubble-content]]:bg-message-user [&>[data-slot=bubble-content]]:text-message-user-text",
  secondary:
    "[&>[data-slot=bubble-content]]:bg-message-assistant [&>[data-slot=bubble-content]]:text-message-assistant-text",
  muted: "[&>[data-slot=bubble-content]]:bg-bg-subtle [&>[data-slot=bubble-content]]:text-text",
  tinted: "[&>[data-slot=bubble-content]]:bg-tint [&>[data-slot=bubble-content]]:text-text",
  outline:
    "[&>[data-slot=bubble-content]]:bg-surface-raised [&>[data-slot=bubble-content]]:text-text [&>[data-slot=bubble-content]]:shadow-[inset_0_0_0_1px_var(--panel-edge)]",
  ghost: "[&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:p-0",
  destructive:
    "[&>[data-slot=bubble-content]]:bg-danger/15 [&>[data-slot=bubble-content]]:text-danger",
}

export type BubbleContentProps<T extends ValidComponent = "div"> = {
  /** Render as a different element - `button` or `a` - to make the bubble
   *  itself interactive, so it is focusable and exposes the right role. */
  as?: T
  class?: string | undefined
  children?: JSX.Element
} & Omit<ComponentProps<T>, "as" | "class" | "children">

/**
 * The painted, clipping surface. Text and rich content go here.
 *
 * `overflow-hidden` is what keeps a long word inside the radius. `white-space`
 * is deliberately NOT set here: a link card is a child too, and `pre-wrap`
 * would render its own text with the body's line breaks.
 */
export function BubbleContent<T extends ValidComponent = "div">(
  rawProps: BubbleContentProps<T>,
) {
  const props = mergeProps({ as: "div" as T } as const, rawProps)
  const [local, others] = splitProps(props as BubbleContentProps, ["as", "class"])
  return (
    <Dynamic
      component={local.as}
      data-slot="bubble-content"
      class={cn(
        "w-fit min-w-0 max-w-full overflow-hidden rounded-bubble px-(--bubble-pad-x) py-(--bubble-pad-y) text-base wrap-break-word",
        local.class,
      )}
      {...others}
    />
  )
}

/**
 * How far the row is pulled past the bubble's edge.
 *
 * Vertically this is kat's 12px: the badge reads as sitting on the corner
 * rather than floating off it.
 *
 * Horizontally it is 18px, NOT kat's 12. A badge is 28px wide, so 12px leaves
 * its inner edge 16px inside the bubble - four pixels past the 12px text inset,
 * which is the sliver that clipped the first letter of a one-line message.
 * Eighteen puts the inner edge at 10px, just clear of the text, so the chip
 * covers the corner arc and nothing else. The bubble's own size never changes:
 * padding it to make room was tried and makes a message physically resize the
 * moment it is reacted to.
 */
const OVERHANG = "-top-3"
const OVERHANG_BOTTOM = "-bottom-3"
const OVERHANG_START = "-left-[18px]"
const OVERHANG_END = "-right-[18px]"

export type BubbleReactionsProps = ComponentProps<"div"> & {
  /** Which edge of the bubble the row is pinned to. */
  align?: BubbleAlign
  /** Which edge of the bubble the row overlaps. */
  side?: "top" | "bottom"
}

/**
 * A row that overlaps the bubble's edge. A sibling of `BubbleContent`.
 *
 * Absolute, so it costs no layout: `MessageRow`'s padding is the same whether
 * or not a message is reacted, and adding a chip never moves the transcript.
 *
 * The row is `pointer-events-none` so it cannot swallow a click meant for the
 * bubble underneath; the badge inside opts back in.
 */
export function BubbleReactions(rawProps: BubbleReactionsProps) {
  const props = mergeProps({ align: "end" as BubbleAlign, side: "bottom" as const }, rawProps)
  const [local, others] = splitProps(props, ["align", "class", "side"])
  return (
    <div
      data-slot="bubble-reactions"
      data-align={local.align}
      data-side={local.side}
      class={cn(
        "pointer-events-none absolute z-[6] flex w-fit items-center justify-center",
        local.side === "top" ? OVERHANG : OVERHANG_BOTTOM,
        local.align === "start" ? OVERHANG_START : OVERHANG_END,
        local.class,
        // kat's two run directions, and the 8px overlap that makes a stack read
        // as one cluster rather than a row of loose circles.
        //
        // The row hangs off ONE edge and the FIRST reaction has to sit on the
        // bubble's own corner, so a stack off the LEFT edge runs `row` and each
        // later circle pulls back toward it (`-ml-2`), while a stack off the
        // RIGHT edge runs `row-reverse` and each later circle pulls right
        // (`-mr-2`). Either way exactly one ring lands on the corner and the
        // rest run out toward the gutter.
        local.align === "start"
          ? "flex-row [&>*+*]:-ml-2"
          : "flex-row-reverse [&>*+*]:-mr-2",
      )}
      {...others}
    />
  )
}
