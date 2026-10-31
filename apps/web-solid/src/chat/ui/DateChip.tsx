import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon } from "@kiko/ui/icons"
import { Show, Suspense, createSignal, lazy, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { dayChipLabel, formatFullTimestamp } from "../lib/dayLabel"

const loadCalendar = () => import("./DateCalendar")
const DateCalendar = lazy(loadCalendar)

export function DateChip(props: {
  dayStart: number
  now: number
  visible: boolean
  onJumpToDay: (dayStart: number) => void
  hasDay?: (dayStart: number) => boolean
  class?: string
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [month, setMonth] = createSignal(new Date(props.dayStart))
  const [picked, setPicked] = createSignal<Date | null>(new Date(props.dayStart))
  const [picking, setPicking] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)
  let trigger: HTMLButtonElement | undefined

  const close = () => {
    setOpen(false)
    setPicking(false)
  }
  const toggle = () => {
    if (open()) {
      close()
      return
    }
    setMonth(new Date(props.dayStart))
    setPicked(new Date(props.dayStart))
    setOpen(true)
  }
  const onWheel: JSX.EventHandlerUnion<HTMLDivElement, WheelEvent> = (event) => {
    if (open()) event.stopPropagation()
  }

  return (
    <div
      class={cn(
        "chat-chip-anchor pointer-events-none absolute top-[calc(0.625rem+var(--top-bar-h,0px))] right-5 left-3 z-20 flex-col items-center",
        "invisible flex opacity-0 transition-[opacity,visibility] duration-(--duration-fast) ease-sharp motion-reduce:transition-none",
        "data-[visible]:visible data-[visible]:opacity-100",
        props.class,
      )}
      data-component="chat-date-chip"
      data-visible={props.visible || open() || hovered() ? "" : undefined}
      data-open={open() ? "" : undefined}
      onWheel={onWheel}
    >
      <DismissableLayerV2
        active={open()}
        class={cn(
          "flex w-max max-w-full flex-col items-stretch overflow-clip text-primary",
          open()
            ? "w-[320px] max-w-full rounded-3xl bg-elevated shadow-popup"
            : "rounded-full bg-chrome shadow-[0_6px_16px_-6px_oklch(0%_0_none/0.22),0_0_0_1px_color-mix(in_oklab,var(--text-primary)_6%,transparent)]",
        )}
        excludedElements={() => [trigger]}
        onDismiss={close}
      >
        <div class={cn("relative flex items-center justify-center", open() ? "min-h-11 px-3 pt-2" : "min-h-6")}>
          <button
            ref={(element) => {
              trigger = element
            }}
            type="button"
            class={cn(
              "chat-chip pointer-events-auto min-h-6 cursor-pointer rounded-full px-3 py-1 type-sm font-semibold text-secondary transition-colors duration-(--duration-fast) hover:bg-tertiary aria-expanded:bg-tertiary",
              open() && "bg-secondary",
            )}
            data-component="chat-day-chip"
            aria-expanded={open()}
            aria-haspopup="dialog"
            title={formatFullTimestamp(props.dayStart)}
            onClick={toggle}
            onPointerEnter={() => {
              setHovered(true)
              void loadCalendar()
            }}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => void loadCalendar()}
          >
            {dayChipLabel(props.dayStart, props.now)}
          </button>
          <Show when={open()}>
            <button
              type="button"
              class="pointer-events-auto absolute top-[calc(50%+4px)] right-3 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-secondary hover:bg-tertiary hover:text-primary"
              aria-label="Close calendar"
              onClick={close}
            >
              <RemixIcon icon={CloseIcon} class="size-4" />
            </button>
          </Show>
        </div>
        <Show when={open()}>
          <Suspense fallback={<div class="h-[300px] w-full" />}>
            <DateCalendar
              dayStart={props.dayStart}
              picked={picked()}
              setPicked={setPicked}
              month={month()}
              setMonth={setMonth}
              picking={picking()}
              setPicking={setPicking}
              close={close}
              onJumpToDay={props.onJumpToDay}
              hasDay={props.hasDay}
            />
          </Suspense>
        </Show>
      </DismissableLayerV2>
    </div>
  )
}
