import Calendar from "@corvu/calendar"
import { createEventListener } from "@solid-primitives/event-listener"
import { Index, Show, createSignal, type JSX } from "solid-js"
import { dayStartOf } from "../lib/grouping"
import { dayChipLabel, formatFullTimestamp } from "../lib/dayLabel"

const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: "short" })
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })

/**
 * The floating date chip. It shows only while the topmost row is today's
 * messages and hides as soon as yesterday's are on screen; `visible` is the
 * parent's read of the scroll position, not a second scroll observer here.
 *
 * Opening it reveals a month grid. Choosing a day hands the day's start back to
 * the transcript, which scrolls to the first message of that day and closes the
 * grid on the way out.
 */
export function DateChip(props: {
  dayStart: number
  now: number
  visible: boolean
  onJumpToDay: (dayStart: number) => void
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [month, setMonth] = createSignal(new Date(props.dayStart))
  const [picked, setPicked] = createSignal<Date | null>(new Date(props.dayStart))

  const close = () => setOpen(false)
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
      class="chat-chip-anchor"
      data-component="chat-date-chip"
      data-visible={props.visible ? "" : undefined}
      data-open={open() ? "" : undefined}
      onWheel={onWheel}
    >
      <button
        type="button"
        class="chat-chip"
        aria-expanded={open()}
        aria-haspopup="dialog"
        title={formatFullTimestamp(props.dayStart)}
        onClick={() => setOpen((was) => !was)}
      >
        {dayChipLabel(props.dayStart, props.now)}
      </button>
      <Show when={open()}>
        <div class="chat-calendar" role="dialog" aria-label="jump to day">
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
            startOfWeek={1}
          >
            {(calendar) => (
              <>
                <div class="chat-calendar__nav">
                  <Calendar.Nav
                    action="prev-month"
                    class="chat-calendar__nav-btn"
                    aria-label="previous month"
                  >
                    &#8249;
                  </Calendar.Nav>
                  <Calendar.Label class="chat-calendar__title">
                    {MONTH_YEAR.format(calendar.month)}
                  </Calendar.Label>
                  <Calendar.Nav
                    action="next-month"
                    class="chat-calendar__nav-btn"
                    aria-label="next month"
                  >
                    &#8250;
                  </Calendar.Nav>
                </div>
                <Calendar.Table class="chat-calendar__table">
                  <thead>
                    <tr>
                      {/* `Index` yields accessors, not values — hence the calls. */}
                      <Index each={calendar.weekdays}>
                        {(day) => (
                          <Calendar.HeadCell class="chat-calendar__weekday" scope="col">
                            {WEEKDAY_SHORT.format(day())}
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
                              <Calendar.Cell class="chat-calendar__cell">
                                <Calendar.CellTrigger class="chat-calendar__day" day={day()}>
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
              </>
            )}
          </Calendar>
        </div>
      </Show>
    </div>
  )
}
