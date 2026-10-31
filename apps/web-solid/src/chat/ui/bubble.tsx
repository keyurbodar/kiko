import { type ComponentProps, type JSX, mergeProps, splitProps, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import { cn } from "../../lib/cn"
import "./bubble.css"

export type BubbleVariant = "default" | "secondary" | "muted" | "tinted" | "outline" | "ghost" | "destructive"

const VARIANTS: Record<BubbleVariant, string> = {
  default: "[&>[data-slot=bubble-content]]:bg-quaternary [&>[data-slot=bubble-content]]:text-primary",
  secondary: "[&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:text-primary",
  muted: "[&>[data-slot=bubble-content]]:bg-editor [&>[data-slot=bubble-content]]:text-primary",
  tinted: "[&>[data-slot=bubble-content]]:bg-secondary [&>[data-slot=bubble-content]]:text-primary",
  outline:
    "[&>[data-slot=bubble-content]]:bg-editor [&>[data-slot=bubble-content]]:text-primary [&>[data-slot=bubble-content]]:shadow-[inset_0_0_0_1px_var(--stroke-secondary)]",
  ghost: "[&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:p-0",
  destructive:
    "[&>[data-slot=bubble-content]]:bg-quaternary [&>[data-slot=bubble-content]]:text-primary [&>[data-slot=bubble-content]]:shadow-[inset_0_0_0_1px_var(--stroke-danger)]",
}

export type BubbleAlign = "start" | "end"

export type BubblePosition = "only" | "first" | "middle" | "last"

export type BubbleProps = ComponentProps<"div"> & {
  variant?: BubbleVariant
  align?: BubbleAlign
  position?: BubblePosition
}

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
        "relative flex w-fit min-w-0 max-w-full flex-col gap-1",
        "data-[align=end]:ml-[20%] data-[align=end]:max-w-[80%] data-[align=end]:self-end data-[variant=ghost]:max-w-full",
        VARIANTS[local.variant],
        local.class,
      )}
      {...others}
    />
  )
}

export type BubbleContentProps<T extends ValidComponent = "div"> = {
  as?: T
  class?: string | undefined
  children?: JSX.Element
} & Omit<ComponentProps<T>, "as" | "class" | "children">

export function BubbleContent<T extends ValidComponent = "div">(rawProps: BubbleContentProps<T>) {
  const props = mergeProps({ as: "div" as T } as const, rawProps)
  const [local, others] = splitProps(props as BubbleContentProps, ["as", "class"])
  return (
    <Dynamic
      component={local.as}
      data-slot="bubble-content"
      class={cn(
        "w-fit min-w-0 max-w-full overflow-hidden rounded-(--bubble-r) px-(--bubble-pad-x) py-(--bubble-pad-y) wrap-break-word",
        local.class,
      )}
      {...others}
    />
  )
}

const OVERHANG = "-top-3"
const OVERHANG_BOTTOM = "-bottom-3"
const OVERHANG_START = "-left-[18px]"
const OVERHANG_END = "-right-[18px]"

export type BubbleReactionsProps = ComponentProps<"div"> & {
  align?: BubbleAlign
  side?: "top" | "bottom"
}

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
        local.align === "start" ? "flex-row [&>*+*]:-ml-2" : "flex-row-reverse [&>*+*]:-mr-2",
      )}
      {...others}
    />
  )
}
