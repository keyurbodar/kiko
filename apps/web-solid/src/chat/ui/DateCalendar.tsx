import Calendar from "@corvu/calendar"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@kiko/ui/icons"
import { Index, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { dayStartOf } from "../lib/grouping"

const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: "short" })
const MONTH_SHORT = new Intl.DateTimeFormat(undefined, { month: "short" })
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })

const MONTHS = Array.from({ length: 12 }, (_, index) => new Date(2000, index, 1))

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
    <div class="chat-calendar pointer-events-auto flex w-full flex-col items-center px-3 pt-1 pb-3">
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
                class="chat-calendar__title -ml-2 flex cursor-pointer items-center gap-1 rounded-row px-2 py-1 text-msg font-medium whitespace-nowrap text-info hover:bg-hover"
                aria-expanded={picking()}
                onClick={() => setPicking((was) => !was)}
              >
                {picking() ? calendar.month.getFullYear() : MONTH_YEAR.format(calendar.month)}
                <RemixIcon icon={ChevronDownIcon} class={cn("size-4", picking() && "rotate-180")} />
              </button>
              <div class="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  class="grid size-7 cursor-pointer place-items-center rounded-full text-fg2 hover:bg-hover hover:text-fg"
                  aria-label={picking() ? "Previous year" : "Previous month"}
                  onClick={() => calendar.navigate(picking() ? "prev-year" : "prev-month")}
                >
                  <RemixIcon icon={ChevronLeftIcon} class="size-4" />
                </button>
                <button
                  type="button"
                  class="grid size-7 cursor-pointer place-items-center rounded-full text-fg2 hover:bg-hover hover:text-fg"
                  aria-label={picking() ? "Next year" : "Next month"}
                  onClick={() => calendar.navigate(picking() ? "next-year" : "next-month")}
                >
                  <RemixIcon icon={ChevronRightIcon} class="size-4" />
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
                          "cursor-pointer rounded-row py-2 text-label",
                          "hover:bg-[oklch(from_var(--fg)_l_c_h_/_6%)]",
                          "aria-current:bg-[oklch(from_var(--info)_l_c_h_/_22%)]",
                          "aria-current:font-bold aria-current:text-info",
                        )}
                        aria-current={day().getMonth() === calendar.month.getMonth() ? "true" : undefined}
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
              <Calendar.Table class="w-full border-collapse table-fixed">
                <thead>
                  <tr>
                    <Index each={calendar.weekdays}>
                      {(day) => (
                        <Calendar.HeadCell class="h-7 text-center text-label font-medium text-fg2" scope="col">
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
                                  "not-data-disabled:hover:bg-[oklch(from_var(--fg)_l_c_h_/_6%)]",
                                  "active:not-data-disabled:scale-[0.92]",
                                  "data-disabled:text-fg2 data-disabled:opacity-45",
                                  "data-[today]:font-bold data-[today]:text-info",
                                  "data-selected:font-bold data-selected:text-info",
                                  "data-selected:bg-[oklch(from_var(--info)_l_c_h_/_22%)]",
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
  )
}
