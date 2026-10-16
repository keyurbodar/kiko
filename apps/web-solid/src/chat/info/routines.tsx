import type { RecipeCard, Trigger } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ClockIcon, TrashIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createResource, createSignal, For, Show } from "solid-js"
import { RecipeIcon } from "../../recipes/icon"
import { recipeForRoutine } from "../../recipes/model"
import { triggerLabel } from "./routines-model"
import { apiFetch } from "../../lib/api"
import { watchChanged } from "../../sync/changed"

export type Routine = { id: string; name: string; roomId: string; status: "active" | "paused"; trigger: Trigger; tz: string }

export type Reminder = { id: string; text: string; roomId: string; dueUtc: number; rrule?: string; tz: string }

const [reminders, setReminders] = createSignal<readonly Reminder[]>([])
const [all, setAll] = createSignal<readonly Routine[] | undefined>(undefined)
const [started, setStarted] = createSignal<ReadonlySet<string>>(new Set())
export const ranNow = (id: string): boolean => started().has(id)

function read(value: unknown): Routine[] {
  const rows = (value as { routines?: unknown })?.routines
  if (!Array.isArray(rows)) return []
  return rows.flatMap((r: Record<string, unknown>) =>
    typeof r?.id === "string" && typeof r.roomId === "string" && r.trigger && (r.status === "active" || r.status === "paused")
      ? [{ id: r.id, name: typeof r.name === "string" && r.name ? r.name : "Routine", roomId: r.roomId, status: r.status, trigger: r.trigger as Trigger, tz: typeof r.tz === "string" ? r.tz : "UTC" }]
      : [],
  )
}

function readReminders(value: unknown): Reminder[] {
  const rows = (value as { reminders?: unknown })?.reminders
  if (!Array.isArray(rows)) return []
  return rows.flatMap((r: Record<string, unknown>) =>
    typeof r?.id === "string" && typeof r.text === "string" && typeof r.roomId === "string" && typeof r.dueUtc === "number"
      ? [{ id: r.id, text: r.text, roomId: r.roomId, dueUtc: r.dueUtc, ...(typeof r.rrule === "string" ? { rrule: r.rrule } : {}), tz: typeof r.tz === "string" ? r.tz : "UTC" }]
      : [],
  )
}

export async function loadRoutines(): Promise<void> {
  watchChanged("routines", loadRoutines)
  const res = await apiFetch("/api/routines").catch(() => null)
  if (!res?.ok) {
    if (all() === undefined) setAll([])
    return
  }
  const body = await res.json().catch(() => null)
  setAll(read(body))
  setReminders(readReminders(body))
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined
/** The room moved, so a routine or a reminder may have been made. Asks once after the burst. */
export function refreshRoutines(delay = 1200): void {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void loadRoutines(), delay)
}

export const remindersOf = (chatId: string): readonly Reminder[] => reminders().filter((r) => r.roomId === chatId)

/** What a reminder says about when, in the words a routine uses. */
export const reminderWhen = (r: Reminder): string => triggerLabel({ on: "time", at: new Date(r.dueUtc).toISOString(), ...(r.rrule ? { rrule: r.rrule } : {}) }, r.tz)

export async function cancelReminder(reminder: Reminder): Promise<void> {
  setReminders((list) => list.filter((r) => r.id !== reminder.id))
  if (!(await post(`/api/reminders/${reminder.id}/cancel`, {}))) {
    setReminders((list) => [...list, reminder].sort((a, b) => a.dueUtc - b.dueUtc))
    showToastV2({ title: "Could not delete the reminder", variant: "error" })
  }
}

export const routinesOf = (chatId: string): readonly Routine[] | undefined => all()?.filter((r) => r.roomId === chatId)

const post = (path: string, body: unknown) =>
  apiFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.ok).catch(() => false)

export async function setStatus(routine: Routine, status: Routine["status"]): Promise<void> {
  const put = (s: Routine["status"]) => setAll((list) => list?.map((r) => (r.id === routine.id ? { ...r, status: s } : r)))
  put(status)
  if (!(await post(`/api/routines/${routine.id}`, { status }))) {
    put(routine.status)
    showToastV2({ title: `Could not ${status === "paused" ? "pause" : "resume"} ${routine.name}`, variant: "error" })
  }
}

export async function runNow(routine: Routine): Promise<void> {
  setStarted((s) => new Set(s).add(routine.id))
  if (!(await post(`/api/routines/${routine.id}/run`, {}))) {
    setStarted((s) => {
      const next = new Set(s)
      next.delete(routine.id)
      return next
    })
    showToastV2({ title: `Could not run ${routine.name}`, variant: "error" })
  }
}

const faint = "text-[color-mix(in_oklab,var(--foreground)_40%,transparent)]"
const tool =
  "grid size-7 shrink-0 place-items-center rounded-md text-[color-mix(in_oklab,var(--foreground)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-foreground disabled:opacity-40"
const word =
  "h-7 shrink-0 rounded-md px-2 text-[11px] text-[color-mix(in_oklab,var(--foreground)_55%,transparent)] hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-foreground disabled:opacity-40"

function RoutineRow(props: { routine: Routine; recipe?: RecipeCard }) {
  const on = () => props.routine.status === "active"
  const ran = () => started().has(props.routine.id)
  return (
    <li class="flex items-center gap-1 rounded-md pr-1 hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]" data-routine={props.routine.id} data-status={props.routine.status}>
      <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2">
        <Show
          when={props.recipe}
          fallback={
            <span class={`grid size-7 shrink-0 place-items-center rounded-md bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] ${on() ? "text-[color-mix(in_oklab,var(--foreground)_60%,transparent)]" : "text-[color-mix(in_oklab,var(--foreground)_30%,transparent)]"}`} aria-hidden="true">
              <HugeIcon icon={ClockIcon} size={14} />
            </span>
          }
        >
          {(recipe) => <RecipeIcon recipe={recipe()} size={34} />}
        </Show>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class={`truncate text-[12px] leading-5 ${on() ? "text-[color-mix(in_oklab,var(--foreground)_85%,transparent)]" : "text-[color-mix(in_oklab,var(--foreground)_45%,transparent)]"}`}>{props.routine.name}</span>
          <span class={`truncate text-[11px] leading-4 ${faint}`} data-component="routine-trigger">
            <Show when={!ran() && !on()}>
              <span class="mr-1.5 rounded bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] px-1 text-[10px]">Paused</span>
            </Show>
            {ran() ? "Started just now" : triggerLabel(props.routine.trigger, props.routine.tz)}
          </span>
        </span>
      </div>
      <button type="button" class={word} disabled={ran()} data-action="routine-run" onClick={() => void runNow(props.routine)}>
        {ran() ? "Started" : "Run now"}
      </button>
      <button type="button" class={word} data-action="routine-toggle" onClick={() => void setStatus(props.routine, on() ? "paused" : "active")}>
        {on() ? "Pause" : "Resume"}
      </button>
    </li>
  )
}

function ReminderRow(props: { reminder: Reminder }) {
  return (
    <li class="flex items-center gap-1 rounded-md pr-1 hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]" data-reminder={props.reminder.id}>
      <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2">
        <span class="grid size-7 shrink-0 place-items-center rounded-md bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] text-[color-mix(in_oklab,var(--foreground)_60%,transparent)]" aria-hidden="true">
          <HugeIcon icon={ClockIcon} size={14} />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-[12px] leading-5 text-[color-mix(in_oklab,var(--foreground)_85%,transparent)]">{props.reminder.text}</span>
          <span class={`truncate text-[11px] leading-4 ${faint}`} data-component="reminder-when">
            {reminderWhen(props.reminder)}
          </span>
        </span>
      </div>
      <button type="button" class={tool} aria-label="Delete reminder" title="Delete reminder" data-action="reminder-delete" onClick={() => void cancelReminder(props.reminder)}>
        <HugeIcon icon={TrashIcon} size={14} />
      </button>
    </li>
  )
}

const heading = `px-2 pt-2 pb-1 text-[11px] font-medium leading-4 ${faint}`

export function RoutinesPage(props: { chatId: string }) {
  const [recipes] = createResource(() => import("../../recipes/api").then((m) => m.loadCards()))
  return (
    <div class="px-2 py-2" data-component="info-routines">
      <Show when={routinesOf(props.chatId)} fallback={<p class={`px-2 py-6 text-center text-[12px] ${faint}`}>Loading</p>}>
        {(list) => (
          <>
            <Show when={!list().length && !remindersOf(props.chatId).length}>
              <p class={`px-2 py-6 text-center text-[12px] leading-5 ${faint}`}>Nothing scheduled yet. Ask an agent to remind you, or to do something on a schedule or whenever something happens.</p>
            </Show>
            <Show when={list().length}>
              <h3 class={heading}>Routines</h3>
              <ul class="flex flex-col gap-px">
                <For each={list()}>{(routine) => <RoutineRow routine={routine} recipe={recipeForRoutine(recipes() ?? [], routine.name)} />}</For>
              </ul>
            </Show>
            <Show when={remindersOf(props.chatId).length}>
              <h3 class={heading}>Reminders</h3>
              <ul class="flex flex-col gap-px" data-component="info-reminders">
                <For each={remindersOf(props.chatId)}>{(reminder) => <ReminderRow reminder={reminder} />}</For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
