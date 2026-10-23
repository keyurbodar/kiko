import type { RecipeCard, RoutineRow as RoutineData } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, ClockIcon, PauseIcon, PlayIcon, TrashIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { RecipeIcon } from "../../recipes/icon"
import { recipeForRoutine } from "../../recipes/model"
import { triggerLabel } from "./routines-model"
import { apiFetch } from "../../lib/api"
import { useApp } from "../../lib/store"

export type Routine = RoutineData

const [started, setStarted] = createSignal<ReadonlySet<string>>(new Set())
export const ranNow = (id: string): boolean => started().has(id)

export const routinesOf = (chatId: string): readonly Routine[] =>
  useApp.rows("routine").filter((r) => r.roomId === chatId)

const post = (path: string, body: unknown) =>
  apiFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.ok)
    .catch(() => false)

export async function setStatus(routine: Routine, status: Routine["status"]): Promise<void> {
  if (
    !(await useApp.editRow("routine", routine.id, { ...routine, status }, () =>
      post(`/api/routines/${routine.id}`, { status }),
    ))
  )
    showToastV2({ title: `Could not ${status === "paused" ? "pause" : "resume"} ${routine.name}`, variant: "error" })
}

export async function cancelRoutine(routine: Routine): Promise<void> {
  if (!(await useApp.editRow("routine", routine.id, null, () => post(`/api/routines/${routine.id}/cancel`, {}))))
    showToastV2({ title: `Could not delete ${routine.name}`, variant: "error" })
}

const STARTED_MS = 2500

const forget = (id: string) =>
  setStarted((s) => {
    const next = new Set(s)
    next.delete(id)
    return next
  })

export async function runNow(routine: Routine): Promise<boolean> {
  setStarted((s) => new Set(s).add(routine.id))
  if (await post(`/api/routines/${routine.id}/run`, {})) return true
  forget(routine.id)
  showToastV2({ title: `Could not run ${routine.name}`, variant: "error" })
  return false
}

const faint = "text-[color-mix(in_oklab,var(--foreground)_40%,transparent)]"
const tool =
  "grid size-7 shrink-0 place-items-center rounded-md text-[color-mix(in_oklab,var(--foreground)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-foreground disabled:opacity-40"
function Tool(props: {
  label: string
  action: string
  disabled?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <TooltipV2 placement="top" openDelay={400} value={props.label}>
      <button
        type="button"
        class={tool}
        aria-label={props.label}
        disabled={props.disabled}
        data-action={props.action}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </TooltipV2>
  )
}

function RoutineRow(props: { routine: Routine; recipe?: RecipeCard }) {
  const on = () => props.routine.status === "active"
  const ran = () => started().has(props.routine.id)
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
    clearTimeout(timer)
    forget(props.routine.id)
  })
  const run = async () => {
    clearTimeout(timer)
    if (!(await runNow(props.routine)) || disposed) return
    timer = setTimeout(() => forget(props.routine.id), STARTED_MS)
  }
  return (
    <li
      class="flex items-center gap-1 rounded-md pr-1 hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]"
      data-routine={props.routine.id}
      data-status={props.routine.status}
    >
      <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2">
        <Show
          when={props.recipe}
          fallback={
            <span
              class={`grid size-7 shrink-0 place-items-center rounded-md bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] ${on() ? "text-[color-mix(in_oklab,var(--foreground)_60%,transparent)]" : "text-[color-mix(in_oklab,var(--foreground)_30%,transparent)]"}`}
              aria-hidden="true"
            >
              <RemixIcon icon={ClockIcon} size={14} />
            </span>
          }
        >
          {(recipe) => <RecipeIcon recipe={recipe()} size={34} />}
        </Show>
        <span class="flex min-w-0 flex-1 flex-col">
          <span
            class={`truncate text-[12px] leading-5 ${on() ? "text-[color-mix(in_oklab,var(--foreground)_85%,transparent)]" : "text-[color-mix(in_oklab,var(--foreground)_45%,transparent)]"}`}
          >
            {props.routine.name}
          </span>
          <span class={`truncate text-[11px] leading-4 ${faint}`} data-component="routine-trigger">
            <Show when={!ran() && !on()}>
              <span class="mr-1.5 rounded bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] px-1 text-[10px]">
                Paused
              </span>
            </Show>
            {ran() ? "Started just now" : triggerLabel(props.routine.trigger, props.routine.tz)}
          </span>
        </span>
      </div>
      <Tool label={ran() ? "Started" : "Run now"} action="routine-run" disabled={ran()} onClick={() => void run()}>
        <RemixIcon icon={ran() ? CheckIcon : PlayIcon} size={14} />
      </Tool>
      <Tool
        label={on() ? "Pause" : "Resume"}
        action="routine-toggle"
        onClick={() => void setStatus(props.routine, on() ? "paused" : "active")}
      >
        <RemixIcon icon={on() ? PauseIcon : PlayIcon} size={14} />
      </Tool>
      <Tool label="Delete routine" action="routine-delete" onClick={() => void cancelRoutine(props.routine)}>
        <RemixIcon icon={TrashIcon} size={14} />
      </Tool>
    </li>
  )
}

const heading = `px-2 pt-2 pb-1 text-[11px] font-medium leading-4 ${faint}`

export function RoutinesPage(props: { chatId: string }) {
  const [recipes] = createResource(() => import("../../recipes/api").then((m) => m.loadCards()))
  return (
    <div class="px-2 py-2" data-component="info-routines">
      <Show when={routinesOf(props.chatId)}>
        {(list) => (
          <>
            <Show when={!list().length}>
              <p class={`px-2 py-6 text-center text-[12px] leading-5 ${faint}`}>
                Nothing scheduled yet. Ask an agent to remind you, or to do something on a schedule or whenever you send
                a message.
              </p>
            </Show>
            <Show when={list().length}>
              <h3 class={heading}>Routines</h3>
              <ul class="flex flex-col gap-px">
                <For each={list()}>
                  {(routine) => (
                    <RoutineRow routine={routine} recipe={recipeForRoutine(recipes() ?? [], routine.name)} />
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
