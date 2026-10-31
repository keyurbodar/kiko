import type { RecipeCard, RoutineRow as RoutineData } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, ClockIcon, PauseIcon, PlayIcon, TrashIcon } from "@kiko/ui/icons"
import { Link } from "@tanstack/solid-router"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { RecipeIcon } from "../../recipes/icon"
import { recipeForRoutine } from "../../recipes/model"
import { leadName, PanelEmpty } from "./empty"
import { triggerLabel } from "./routines-model"
import { apiFetch } from "../../lib/api"
import { createQuery, owner, run } from "../../state/runtime"
import { user } from "../../state/user"

export type Routine = RoutineData

const [started, setStarted] = createSignal<ReadonlySet<string>>(new Set())

const routinesOf = (chatId: string): readonly Routine[] => user.rows("routine").filter((r) => r.roomId === chatId)

const post = (path: string, body: unknown) =>
  apiFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.ok)
    .catch(() => false)

async function setStatus(routine: Routine, status: Routine["status"]): Promise<void> {
  if ((await run(owner.commands.routinesUpdate, { id: routine.id, status }))._tag === "Failure")
    showToastV2({ title: `Could not ${status === "paused" ? "pause" : "resume"} ${routine.name}`, variant: "error" })
}

async function cancelRoutine(routine: Routine): Promise<void> {
  if ((await run(owner.commands.routinesCancel, { id: routine.id }))._tag === "Failure")
    showToastV2({ title: `Could not delete ${routine.name}`, variant: "error" })
}

const STARTED_MS = 2500

const forget = (id: string) =>
  setStarted((s) => {
    const next = new Set(s)
    next.delete(id)
    return next
  })

async function runNow(routine: Routine): Promise<boolean> {
  setStarted((s) => new Set(s).add(routine.id))
  if (await post(`/api/routines/${routine.id}/run`, {})) return true
  forget(routine.id)
  showToastV2({ title: `Could not run ${routine.name}`, variant: "error" })
  return false
}

const faint = "text-quaternary"
const tool =
  "grid size-7 shrink-0 place-items-center rounded-base text-tertiary transition-[background-color,transform] duration-[120ms] active:scale-[0.97] hover:bg-tertiary hover:text-primary disabled:opacity-(--opacity-disabled)"
function Tool(props: {
  label: string
  action: string
  disabled?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <TooltipV2 placement="top" openDelay={500} value={props.label}>
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
      class="flex items-center gap-1 rounded-base pr-1 transition-colors duration-[120ms] hover:bg-tertiary"
      data-routine={props.routine.id}
      data-status={props.routine.status}
    >
      <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2">
        <Show
          when={props.recipe}
          fallback={
            <span
              class={`grid size-7 shrink-0 place-items-center rounded-base bg-tertiary ${on() ? "text-secondary" : "text-quaternary"}`}
              aria-hidden="true"
            >
              <RemixIcon icon={ClockIcon} size={16} />
            </span>
          }
        >
          {(recipe) => <RecipeIcon recipe={recipe()} size={34} />}
        </Show>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class={`truncate text-xs ${on() ? "text-primary" : "text-tertiary"}`}>{props.routine.name}</span>
          <span class={`truncate text-xs ${faint}`} data-component="routine-trigger">
            <Show when={!ran() && !on()}>
              <span class="mr-1.5 rounded bg-tertiary px-1 text-xs">Paused</span>
            </Show>
            {ran() ? "Started just now" : triggerLabel(props.routine.trigger, props.routine.tz)}
          </span>
        </span>
      </div>
      <Tool label={ran() ? "Started" : "Run now"} action="routine-run" disabled={ran()} onClick={() => void run()}>
        <RemixIcon icon={ran() ? CheckIcon : PlayIcon} size={16} />
      </Tool>
      <Tool
        label={on() ? "Pause" : "Resume"}
        action="routine-toggle"
        onClick={() => void setStatus(props.routine, on() ? "paused" : "active")}
      >
        <RemixIcon icon={on() ? PauseIcon : PlayIcon} size={16} />
      </Tool>
      <Tool label="Delete routine" action="routine-delete" onClick={() => void cancelRoutine(props.routine)}>
        <RemixIcon icon={TrashIcon} size={16} />
      </Tool>
    </li>
  )
}

const heading = "px-2 pt-2 pb-1 text-sm text-tertiary"

export function RoutinesPage(props: { chatId: string }) {
  const listed = createQuery(() => (routinesOf(props.chatId).length ? owner.queries.recipes(undefined) : null))
  const [builtIn] = createResource(() =>
    import("../../recipes/catalog.gen").then(
      (m) => m.RECIPES,
      () => [],
    ),
  )
  const recipes = () => listed()?.cards ?? builtIn()
  return (
    <div class="px-2 py-2" data-component="info-routines">
      <Show when={routinesOf(props.chatId)}>
        {(list) => (
          <>
            <Show when={!list().length}>
              <PanelEmpty
                component="routines-empty"
                art="scheduled"
                title="No routines yet"
                line={`Ask ${leadName()} to remind you, or to do something every morning.`}
                action={
                  <Link
                    to="/recipes"
                    class="flex h-control-xl items-center rounded-base bg-tertiary px-3 type-base text-primary transition-[background-color,transform] duration-(--duration-fast) ease-sharp hover:bg-quaternary active:scale-[0.98]"
                    data-action="browse-recipes"
                  >
                    Browse recipes
                  </Link>
                }
              />
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
