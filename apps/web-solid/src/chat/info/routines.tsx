import type { Trigger } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ClockIcon, PauseIcon, PlayIcon, SparklesIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal, For, Show } from "solid-js"
import { triggerLabel } from "./routines-model"

/*
 * A chat's routines (architecture section 25) in the details panel, where monocode lists a Mono's
 * habits (features/monos/ui/MonoHabits.tsx `HabitRow`): a clock tile, the name, what starts it,
 * and run now (monocode's zap; sparkles here) and pause or resume. Both buttons are always shown. An agent sets a routine up when asked;
 * here the human sees them, runs one now, and pauses or resumes it. Each change applies at once
 * and is put back if the server refuses it.
 */

export type Routine = { id: string; name: string; roomId: string; status: "active" | "paused"; trigger: Trigger; tz: string }

const [all, setAll] = createSignal<readonly Routine[] | undefined>(undefined)
const [started, setStarted] = createSignal<ReadonlySet<string>>(new Set())

/** Only what the panel draws, from the wire's reminder rows: a routine has a trigger and is live. */
function read(value: unknown): Routine[] {
  const rows = (value as { routines?: unknown })?.routines
  if (!Array.isArray(rows)) return []
  return rows.flatMap((r: Record<string, unknown>) =>
    typeof r?.id === "string" && typeof r.roomId === "string" && r.trigger && (r.status === "active" || r.status === "paused")
      ? [{ id: r.id, name: typeof r.name === "string" && r.name ? r.name : "Routine", roomId: r.roomId, status: r.status, trigger: r.trigger as Trigger, tz: typeof r.tz === "string" ? r.tz : "UTC" }]
      : [],
  )
}

/** Fetches every routine once per panel open. The list is small and per user. */
export async function loadRoutines(): Promise<void> {
  const res = await fetch("/api/routines").catch(() => null)
  if (res?.ok) setAll(read(await res.json().catch(() => null)))
  else if (all() === undefined) setAll([])
}

export const routinesOf = (chatId: string): readonly Routine[] | undefined => all()?.filter((r) => r.roomId === chatId)

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.ok).catch(() => false)

async function setStatus(routine: Routine, status: Routine["status"]): Promise<void> {
  const put = (s: Routine["status"]) => setAll((list) => list?.map((r) => (r.id === routine.id ? { ...r, status: s } : r)))
  put(status)
  if (!(await post(`/api/routines/${routine.id}`, { status }))) {
    put(routine.status)
    showToastV2({ title: `Could not ${status === "paused" ? "pause" : "resume"} ${routine.name}`, variant: "error" })
  }
}

async function runNow(routine: Routine): Promise<void> {
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

const faint = "text-[color-mix(in_oklab,var(--text)_40%,transparent)]"
const tool =
  "grid size-7 shrink-0 place-items-center rounded-md text-[color-mix(in_oklab,var(--text)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_8%,transparent)] hover:text-text disabled:opacity-40"

function RoutineRow(props: { routine: Routine }) {
  const on = () => props.routine.status === "active"
  const ran = () => started().has(props.routine.id)
  return (
    <li class="flex items-center gap-1 rounded-md pr-1 hover:bg-[color-mix(in_oklab,var(--text)_5%,transparent)]" data-routine={props.routine.id} data-status={props.routine.status}>
      <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2">
        <span class={`grid size-7 shrink-0 place-items-center rounded-md bg-[color-mix(in_oklab,var(--text)_6%,transparent)] ${on() ? "text-[color-mix(in_oklab,var(--text)_60%,transparent)]" : "text-[color-mix(in_oklab,var(--text)_30%,transparent)]"}`} aria-hidden="true">
          <HugeIcon icon={ClockIcon} size={14} />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class={`truncate text-[12px] leading-5 ${on() ? "text-[color-mix(in_oklab,var(--text)_85%,transparent)]" : "text-[color-mix(in_oklab,var(--text)_45%,transparent)]"}`}>{props.routine.name}</span>
          <span class={`truncate text-[11px] leading-4 ${faint}`} data-component="routine-trigger">
            {ran() ? "Started just now" : `${on() ? "" : "Paused · "}${triggerLabel(props.routine.trigger, props.routine.tz)}`}
          </span>
        </span>
      </div>
      <button type="button" class={tool} aria-label={ran() ? "Started" : "Run now"} title={ran() ? "Started" : "Run now"} disabled={ran()} data-action="routine-run" onClick={() => void runNow(props.routine)}>
        <HugeIcon icon={SparklesIcon} size={14} />
      </button>
      <button
        type="button"
        class={tool}
        aria-label={on() ? "Pause" : "Resume"}
        title={on() ? "Pause" : "Resume"}
        data-action="routine-toggle"
        onClick={() => void setStatus(props.routine, on() ? "paused" : "active")}
      >
        <HugeIcon icon={on() ? PauseIcon : PlayIcon} size={14} />
      </button>
    </li>
  )
}

export function RoutinesPage(props: { chatId: string }) {
  return (
    <div class="px-2 py-2" data-component="info-routines">
      <Show when={routinesOf(props.chatId)} fallback={<p class={`px-2 py-6 text-center text-[12px] ${faint}`}>Loading</p>}>
        {(list) => (
          <Show
            when={list().length}
            fallback={<p class={`px-2 py-6 text-center text-[12px] leading-5 ${faint}`}>No routines yet. Ask an agent to do something on a schedule, or whenever something happens.</p>}
          >
            <ul class="flex flex-col gap-px">
              <For each={list()}>{(routine) => <RoutineRow routine={routine} />}</For>
            </ul>
          </Show>
        )}
      </Show>
    </div>
  )
}
