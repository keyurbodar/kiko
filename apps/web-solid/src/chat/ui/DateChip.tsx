import Calendar from "@corvu/calendar"
import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-solid"
import { Index, Show, createSignal, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { dayStartOf } from "../lib/grouping"
import { dayChipLabel, formatFullTimestamp } from "../lib/dayLabel"

const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: "short" })
const MONTH_SHORT = new Intl.DateTimeFormat(undefined, { month: "short" })
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })

const MONTHS = Array.from({ length: 12 }, (_, index) => new Date(2000, index, 1))

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
          open() ? "rounded-[calc(20px*var(--brm))] min-w-[min(320px,100%)]" : "rounded-[15px]",
        )}
        excludedElements={() => [trigger]}
        onDismiss={close}
      >
        <div
          class={cn(
            "relative flex items-center justify-center",
            open() ? "min-h-9" : "min-h-[30px]",
          )}
        >
          <button
            ref={(element) => {
              trigger = element
            }}
            type="button"
            class={cn(
              "chat-chip pointer-events-auto cursor-pointer px-[11px] py-1 text-xs lowercase hover:bg-btn-hover aria-expanded:bg-btn-hover",
              open() ? "min-h-9" : "min-h-[30px]",
            )}
            data-component="chat-day-chip"
            aria-expanded={open()}
            aria-haspopup="dialog"
            title={formatFullTimestamp(props.dayStart)}
            onClick={toggle}
          >
            {dayChipLabel(props.dayStart, props.now)}
          </button>
          <Show when={open()}>
            <button
              type="button"
              class="pointer-events-auto absolute top-1/2 right-[5px] grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-weak hover:bg-btn hover:text-text"
              aria-label="close calendar"
              onClick={close}
            >
              <X class="size-3.5" aria-hidden="true" />
            </button>
          </Show>
        </div>
        <Show when={open()}>
          <div
            class="chat-calendar pointer-events-auto flex w-[300px] flex-col items-center px-2.5 pt-1 pb-2.5"
          >
            <Calendar
              mode="single"
              value={picked()}
              onValueChange={(value: Date | null) => {
                if (!value) return
                const target = dayStartOf(value.getTime())
                setPicked(value)
                setMonth(new Date(target))
                close()
                props.onJumpToDay(target)
              }}
              month={month()}
              onMonthChange={setMonth}
              initialFocusedDay={new Date(props.dayStart)}
              startOfWeek={0}
            >
              {(calendar) => (
                <>
                  <div class="flex min-h-9 w-[280px] items-center gap-0.5">
                    <button
                      type="button"
                      class="chat-calendar__title -ml-2 flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-base font-medium whitespace-nowrap text-accent lowercase hover:bg-btn"
                      aria-expanded={picking()}
                      onClick={() => setPicking((was) => !was)}
                    >
                      {picking()
                        ? calendar.month.getFullYear()
                        : MONTH_YEAR.format(calendar.month)}
                      <ChevronDown
                        class={cn("size-4 transition-transform", picking() && "rotate-180")}
                        aria-hidden="true"
                      />
                    </button>
                    <div class="ml-auto flex items-center gap-0.5">
                      <button
                        type="button"
                        class="grid size-7 cursor-pointer place-items-center rounded-full text-weak hover:bg-btn hover:text-text"
                        aria-label={picking() ? "previous year" : "previous month"}
                        onClick={() =>
                          calendar.navigate(picking() ? "prev-year" : "prev-month")
                        }
                      >
                        <ChevronLeft class="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="grid size-7 cursor-pointer place-items-center rounded-full text-weak hover:bg-btn hover:text-text"
                        aria-label={picking() ? "next year" : "next month"}
                        onClick={() =>
                          calendar.navigate(picking() ? "next-year" : "next-month")
                        }
                      >
                        <ChevronRight class="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <Show
                    when={!picking()}
                    fallback={
                      <div class="grid w-[280px] grid-cols-3 grid-rows-4 gap-1 pt-1">
                        <Index each={MONTHS}>
                          {(day) => (
                            <button
                              type="button"
                              class={cn(
                                "cursor-pointer rounded-[10px] py-2 text-sm lowercase",
                                "hover:bg-[oklch(from_var(--text)_l_c_h_/_6%)]",
                                "aria-current:bg-[oklch(from_var(--accent)_l_c_h_/_22%)]",
                                "aria-current:font-bold aria-current:text-accent",
                              )}
                              aria-current={
                                day().getMonth() === calendar.month.getMonth()
                                  ? "true"
                                  : undefined
                              }
                              onClick={() => {
                                setMonth(new Date(calendar.month.getFullYear(), day().getMonth(), 1))
                                setPicking(false)
                              }}
                            >
                              {MONTH_SHORT.format(day())}
                            </button>
                          )}
                        </Index>
                      </div>
                    }
                  >
                    <Calendar.Table class="w-[280px] border-collapse table-fixed">
                      <thead>
                        <tr>
                          <Index each={calendar.weekdays}>
                            {(day) => (
                              <Calendar.HeadCell
                                class="h-7 text-center text-sm font-medium text-weak lowercase"
                                scope="col"
                              >
                                {WEEKDAY_SHORT.format(day()).slice(0, 2)}
                              </Calendar.HeadCell>
                            )}
                          </Index>
                        </tr>
                      </thead>
                      <tbody>
                        <Index each={calendar.weeks}>
                          {(week) => (
                            <tr>
                              <Index each={week()}>
                                {(day) => (
                                  <Calendar.Cell class="h-10 p-0 text-center">
                                    <Calendar.CellTrigger
                                      class={cn(
                                        "chat-calendar__day mx-auto grid size-9 place-items-center rounded-full p-0",
                                        "tabular-nums cursor-pointer",
                                        "not-data-disabled:hover:bg-[oklch(from_var(--text)_l_c_h_/_6%)]",
                                        "active:not-data-disabled:scale-[0.92]",
                                        "data-disabled:text-weak data-disabled:opacity-45",
                                        "data-[today]:font-bold data-[today]:text-accent",
                                        "data-selected:font-bold data-selected:text-accent",
                                        "data-selected:bg-[oklch(from_var(--accent)_l_c_h_/_22%)]",
                                      )}
                                      day={day()}
                                    >
                                      {day().getDate()}
                                    </Calendar.CellTrigger>
                                  </Calendar.Cell>
                                )}
                              </Index>
                            </tr>
                          )}
                        </Index>
                      </tbody>
                    </Calendar.Table>
                  </Show>
                </>
              )}
            </Calendar>
          </div>
        </Show>
      </DismissableLayerV2>
    </div>
  )
}
