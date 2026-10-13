import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { XIcon } from "lucide-solid"
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
  /** True when the chat has a message that day. Days without one are dimmed and cannot be picked. */
  hasDay?: (dayStart: number) => boolean
  class?: string
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [month, setMonth] = createSignal(new Date(props.dayStart))
  const [picked, setPicked] = createSignal<Date | null>(new Date(props.dayStart))
  const [picking, setPicking] = createSignal(false)
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
        "chat-chip-anchor pointer-events-none absolute top-2.5 right-5 left-3 z-20 flex-col items-center",
        "hidden data-[visible]:flex",
        props.class,
      )}
      data-component="chat-date-chip"
      data-visible={props.visible || open() ? "" : undefined}
      data-open={open() ? "" : undefined}
      onWheel={onWheel}
    >
      <DismissableLayerV2
        active={open()}
        class={cn(
          "flex w-max max-w-full flex-col items-stretch overflow-clip text-text",
          // The chip floats over the transcript, open or closed, so it is the frosted menu surface.
          // The translucent raised fill let the text scrolling under it show through.
          "bg-menu",
          // The shadow belongs to the open calendar. On the closed pill it read as a halo, so the pill
          // gets a hairline instead, which keeps it readable on the light theme's white transcript.
          open()
            ? "rounded-[calc(20px*var(--brm))] w-[320px] max-w-full shadow-popover"
            : "rounded-full shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_10%,transparent)]",
        )}
        excludedElements={() => [trigger]}
        onDismiss={close}
      >
        <div
          class={cn(
            "relative flex items-center justify-center",
            open() ? "min-h-11 px-3 pt-2" : "min-h-6",
          )}
        >
          <button
            ref={(element) => {
              trigger = element
            }}
            type="button"
            class={cn(
              // Monocode's day pill, open or closed: 12px, the day semibold at 75%.
              "chat-chip pointer-events-auto min-h-6 cursor-pointer rounded-full px-3 py-1 text-sm leading-4 font-semibold text-[color-mix(in_oklab,var(--text)_75%,transparent)] hover:bg-btn-hover aria-expanded:bg-btn-hover",
              open() && "bg-btn",
            )}
            data-component="chat-day-chip"
            aria-expanded={open()}
            aria-haspopup="dialog"
            title={formatFullTimestamp(props.dayStart)}
            onClick={toggle}
            onPointerEnter={() => void loadCalendar()}
            onFocus={() => void loadCalendar()}
          >
            {dayChipLabel(props.dayStart, props.now)}
          </button>
          <Show when={open()}>
            <button
              type="button"
              class="pointer-events-auto absolute top-[calc(50%+4px)] right-3 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-weak hover:bg-btn hover:text-text"
              aria-label="Close calendar"
              onClick={close}
            >
              <XIcon class="size-3.5" aria-hidden="true" />
            </button>
          </Show>
        </div>
        <Show when={open()}>
          <Suspense fallback={<div class="h-[300px] w-full" />}>
            <DateCalendar dayStart={props.dayStart} picked={picked()} setPicked={setPicked} month={month()} setMonth={setMonth} picking={picking()} setPicking={setPicking} close={close} onJumpToDay={props.onJumpToDay} hasDay={props.hasDay} />
          </Suspense>
        </Show>
      </DismissableLayerV2>
    </div>
  )
}
