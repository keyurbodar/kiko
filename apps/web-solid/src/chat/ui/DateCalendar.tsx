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
                class="chat-calendar__title -ml-2 flex h-control-md cursor-pointer items-center gap-1 rounded-base px-2 type-base font-semibold whitespace-nowrap text-primary transition-colors hover:bg-quaternary"
                aria-expanded={picking()}
                onClick={() => setPicking((was) => !was)}
              >
                {picking() ? calendar.month.getFullYear() : MONTH_YEAR.format(calendar.month)}
                <RemixIcon icon={ChevronDownIcon} size={12} class={cn("icon-tertiary", picking() && "rotate-180")} />
              </button>
              <div class="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  class="grid size-control-md cursor-pointer place-items-center rounded-base text-secondary transition-colors hover:bg-quaternary hover:text-primary"
                  aria-label={picking() ? "Previous year" : "Previous month"}
                  onClick={() => calendar.navigate(picking() ? "prev-year" : "prev-month")}
                >
                  <RemixIcon icon={ChevronLeftIcon} size={13} />
                </button>
                <button
                  type="button"
                  class="grid size-control-md cursor-pointer place-items-center rounded-base text-secondary transition-colors hover:bg-quaternary hover:text-primary"
                  aria-label={picking() ? "Next year" : "Next month"}
                  onClick={() => calendar.navigate(picking() ? "next-year" : "next-month")}
                >
                  <RemixIcon icon={ChevronRightIcon} size={13} />
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
                          "h-control-lg cursor-pointer rounded-base type-base text-secondary transition-colors",
                          "hover:bg-quaternary hover:text-primary",
                          "aria-current:bg-accent-soft aria-current:font-semibold aria-current:text-accent",
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
                        <Calendar.HeadCell class="h-control-md text-center type-sm text-quaternary" scope="col">
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
                            <Calendar.Cell class="h-9 p-0 text-center">
                              <Calendar.CellTrigger
                                class={cn(
                                  "chat-calendar__day mx-auto grid size-8 place-items-center rounded-base p-0 type-base text-secondary",
                                  "cursor-pointer transition-colors",
                                  "not-data-disabled:hover:bg-quaternary not-data-disabled:hover:text-primary",
                                  "active:not-data-disabled:scale-(--press-scale)",
                                  "data-disabled:text-quaternary",
                                  "data-[today]:font-semibold data-[today]:text-accent",
                                  "data-selected:font-semibold data-selected:text-accent",
                                  "data-selected:bg-accent-soft",
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
