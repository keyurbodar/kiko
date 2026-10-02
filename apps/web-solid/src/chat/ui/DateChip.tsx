import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { X } from "lucide-solid"
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
      data-visible={props.visible ? "" : undefined}
      data-open={open() ? "" : undefined}
      onWheel={onWheel}
    >
      <DismissableLayerV2
        active={open()}
        class={cn(
          "flex w-max max-w-full flex-col items-stretch overflow-clip bg-surface-raised text-text shadow-popover",
          open() ? "rounded-[calc(20px*var(--brm))] w-[320px] max-w-full motion-calendar-open" : "rounded-[15px]",
        )}
        excludedElements={() => [trigger]}
        onDismiss={close}
      >
        <div
          class={cn(
            "relative flex items-center justify-center",
            open() ? "min-h-11 px-3 pt-2" : "min-h-[30px]",
          )}
        >
          <button
            ref={(element) => {
              trigger = element
            }}
            type="button"
            class={cn(
              "chat-chip pointer-events-auto cursor-pointer px-[11px] py-1 text-xs lowercase hover:bg-btn-hover aria-expanded:bg-btn-hover",
              open()
                ? "min-h-7 rounded-full bg-btn px-3 text-sm hover:bg-btn-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                : "min-h-[30px]",
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
              class="pointer-events-auto absolute top-[calc(50%+4px)] right-3 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-weak hover:bg-btn hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="close calendar"
              onClick={close}
            >
              <X class="size-3.5" aria-hidden="true" />
            </button>
          </Show>
        </div>
        <Show when={open()}>
          <Suspense fallback={<div class="h-[300px] w-full" />}>
            <DateCalendar dayStart={props.dayStart} picked={picked()} setPicked={setPicked} month={month()} setMonth={setMonth} picking={picking()} setPicking={setPicking} close={close} onJumpToDay={props.onJumpToDay} />
          </Suspense>
        </Show>
      </DismissableLayerV2>
    </div>
  )
}
