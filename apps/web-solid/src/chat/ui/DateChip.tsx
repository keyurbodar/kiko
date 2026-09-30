import Calendar from "@corvu/calendar"
import { createEventListener } from "@solid-primitives/event-listener"
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-solid"
import { Index, Show, createSignal, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { dayStartOf } from "../lib/grouping"
import { dayChipLabel, formatFullTimestamp } from "../lib/dayLabel"

const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: "short" })
const MONTH_SHORT = new Intl.DateTimeFormat(undefined, { month: "short" })
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })

/** The twelve months in calendar order, so the picker grid never re-formats. */
const MONTHS = Array.from({ length: 12 }, (_, index) => new Date(2000, index, 1))

/**
 * The floating date chip, as the header of a panel that expands beneath it.
 *
 * Kathas one surface doing both jobs: collapsed it is the chip, expanded the
 * same element grows into the calendar and the chip reads as the panel's title.
 * That is why the trigger and the grid share a wrapper — the pill is not a
 * second element floating above a card, it is the card's first row.
 *
 * Opening it reveals a month grid, and the grid's title carries a caret that
 * swaps the days for a twelve-month grid, so a reader can move a year in one
 * click instead of twelve. Choosing a day hands the day's start back to the
 * transcript, which scrolls there and closes the panel on the way out.
 *
 * The anchor is the chip's positioning context, so the grid hangs off it in
 * normal flow rather than through a portal. It is `hidden` — not transparent,
 * not a zero-height row — until the parent writes `data-visible`: there is
 * nothing to fade between "no chip" and "chip", and a chip that is merely
 * transparent still swallows the wheel over the first message.
 */
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
  /** True while the twelve-month grid is showing instead of the days. */
  const [picking, setPicking] = createSignal(false)

  const close = () => {
    setOpen(false)
    setPicking(false)
  }
  const toggle = () => {
    if (open()) {
      close()
      return
    }
    // The chip follows the day at the top of the transcript, so the calendar has
    // to open on THAT day. `month` and `picked` are seeded once at mount, which
    // was harmless while the chip was pinned to today and is wrong the moment it
    // is not: scroll back a day, open the grid, and it would land on the day the
    // component was first rendered.
    setMonth(new Date(props.dayStart))
    setPicked(new Date(props.dayStart))
    setOpen(true)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open()) {
      event.stopPropagation()
      close()
    }
  }
  // The chip lives inside a scroller; a wheel that starts on the open grid would
  // otherwise scroll the transcript out from under it.
  const onWheel: JSX.EventHandlerUnion<HTMLDivElement, WheelEvent> = (event) => {
    if (open()) event.stopPropagation()
  }
  createEventListener(() => document, "keydown", onKeyDown)

  return (
    <div
      class={cn(
        // `chat-chip-anchor` is a handle, not a style: the QA probe reads the
        // anchor's `data-visible` and `data-open` off it.
        "chat-chip-anchor pointer-events-none absolute top-2.5 right-5 left-3 z-20 flex-col items-center",
        "hidden data-[visible]:flex",
        props.class,
      )}
      data-component="chat-date-chip"
      data-visible={props.visible ? "" : undefined}
      data-open={open() ? "" : undefined}
      onWheel={onWheel}
    >
      {/*
        One surface for both states. Collapsed it is only the trigger, a chip of
        `w-max` in a 15px shell; expanded the shell takes the panel's radius and
        a floor width and the body appears under the trigger.
      */}
      <div
        class={cn(
          "flex w-max max-w-full flex-col items-stretch overflow-clip bg-surface-raised text-text shadow-popover",
          open() ? "rounded-[calc(20px*var(--brm))] min-w-[min(320px,100%)]" : "rounded-[15px]",
        )}
      >
        {/* The trigger is the panel's title row: centred, with the close hung
            off its right rather than taking a column of its own. */}
        <div
          class={cn(
            "relative flex items-center justify-center",
            open() ? "min-h-9" : "min-h-[30px]",
          )}
        >
          <button
            type="button"
            class={cn(
              // `chat-chip` is a QA handle, not a style: the verify skill scopes
              // the trigger by it.
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
          {/*
            Seven 40px cells. Corvu lays the month out on a fixed cell, so the nav
            row and the table are both exactly seven cells wide or the header
            drifts off the grid.
          */}
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
              // Sunday first, as kat lays it out. The 300px box less the 10px
              // gutters is exactly the 280px the seven 40px cells need — a
              // 280px box here would put the padding INSIDE the grid and push
              // the columns out of line with their weekday headings.
              startOfWeek={0}
            >
              {(calendar) => (
                <>
                  {/*
                    Title left, navigation right — kat's arrangement. The title is
                    the control that swaps the grid, so it is a button, and it is
                    the only thing here that opens a second view.
                  */}
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
                      /* Twelve months as four rows of three, the shown month
                         marked the way a selected day is. */
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
                          {/* `Index` yields accessors, not values — hence the calls. */}
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
                                    {/*
                                      Corvu flags a day belonging to another month
                                      as `data-disabled` — that is its
                                      `disableOutsideDays` default, and it emits no
                                      `data-outside-month` — so both the hover wash
                                      and the dimming key off it. The hover is 6% of
                                      the text colour, a shade under the button
                                      role's 7%, so a 36px circle does not read as a
                                      slab.
                                    */}
                                    <Calendar.CellTrigger
                                      class={cn(
                                        // `chat-calendar__day` is the handle the QA
                                        // probe scopes day cells by.
                                        // `mx-auto` is load-bearing: the trigger is a
                                        // `grid`, so it is block-level and the cell's
                                        // `text-center` does not centre it — every
                                        // column sat 2px left of its weekday heading.
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
      </div>
    </div>
  )
}
