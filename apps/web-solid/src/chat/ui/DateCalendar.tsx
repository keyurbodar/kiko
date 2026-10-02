import Calendar from "@corvu/calendar"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-solid"
import { Index, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { dayStartOf } from "../lib/grouping"

const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: "short" })
const MONTH_SHORT = new Intl.DateTimeFormat(undefined, { month: "short" })
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })

const MONTHS = Array.from({ length: 12 }, (_, index) => new Date(2000, index, 1))

/* The calendar body of the day chip. It loads on first open, so the corvu calendar stays out of tier 2. */
export default function DateCalendar(props: {
  dayStart: number
  picked: Date | null
  setPicked: (value: Date) => void
  month: Date
  setMonth: (value: Date) => void
  picking: boolean
  setPicking: (value: boolean | ((was: boolean) => boolean)) => void
  close: () => void
  onJumpToDay: (dayStart: number) => void
  hasDay?: (dayStart: number) => boolean
}): JSX.Element {
  const picked = () => props.picked
  const month = () => props.month
  const picking = () => props.picking
  const setPicked = props.setPicked
  const setMonth = props.setMonth
  const setPicking = props.setPicking
  const close = props.close
  return (
          <div
            class="chat-calendar pointer-events-auto flex w-full flex-col items-center px-3 pt-1 pb-3"
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
              disabled={(date: Date) => (props.hasDay ? !props.hasDay(dayStartOf(date.getTime())) : false)}
            >
              {(calendar) => (
                <>
                  <div class="flex min-h-9 w-full items-center gap-0.5">
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
                      <div class="grid w-full grid-cols-3 grid-rows-4 gap-1 pt-1">
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
                    <Show when={`${calendar.month.getFullYear()}-${calendar.month.getMonth()}`} keyed>
                    <Calendar.Table class="motion-calendar-month w-full border-collapse table-fixed">
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
                                        "chat-calendar__day mx-auto grid motion-safe:transition-colors motion-safe:duration-(--motion-fast) size-9 place-items-center rounded-full p-0",
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
                  </Show>
                </>
              )}
            </Calendar>
          </div>
  )
}
