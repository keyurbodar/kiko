import type { RecipeCard } from "@kiko/protocol"
import { ChevronLeftIcon, ClockIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import { openChat } from "../app/history"
import { primaryButton } from "../customize/page-ui"
import { Dialog } from "../lib/dialog"
import { AddPicker } from "./add"
import { AppLogo } from "./icon"
import { localizeWhen } from "./model"
import { InstallRow } from "./row"
import { addToTarget, editRecipe, installsFor, isAdded, isEditing, refreshListing, targetsForChat } from "./state"

const label = "type-label text-fg3"
const sheetSecondary =
  "type-ui flex h-control cursor-pointer items-center gap-2 rounded-control bg-fill px-3 font-medium text-fg transition-[background-color,transform] duration-(--dur-hover) hover:bg-fill-hover active:scale-[0.97] disabled:opacity-(--opacity-disabled)"
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const asksFirst = (count: number) =>
  count === 0 ? "Nothing, it starts right away" : `${count} ${count === 1 ? "question" : "questions"} before it starts`

function Fact(props: { name: string; children: JSX.Element }) {
  return (
    <div class="type-ui flex items-center gap-3 px-4 py-3">
      <span class={`${label} w-22 shrink-0`}>{props.name}</span>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-fg">{props.children}</div>
    </div>
  )
}

function Facts(props: { recipe: RecipeCard; onConnect: () => void }) {
  return (
    <div class="flex flex-col divide-y divide-line rounded-card bg-panel" data-component="recipe-facts">
      <Fact name="Runs">{localizeWhen(props.recipe.when)}</Fact>
      <Show when={props.recipe.apps.length}>
        <Fact name="Uses">
          <For each={props.recipe.apps}>
            {(app) => (
              <span class="flex items-center gap-2" data-app={app.slug}>
                <AppLogo app={app} size={22} />
                {app.name}
                <Show when={app.connected === false}>
                  <button
                    type="button"
                    class="type-label cursor-pointer text-info hover:underline"
                    data-action="connect-recipe-app"
                    onClick={props.onConnect}
                  >
                    Connect
                  </button>
                </Show>
              </span>
            )}
          </For>
        </Fact>
      </Show>
      <Fact name="Asks first">{asksFirst(props.recipe.setup.length)}</Fact>
    </div>
  )
}

export function RecipeSheet(props: {
  recipe: RecipeCard
  onClose: () => void
  roomId?: string | null
  mode?: "add" | "details"
}) {
  const go = (roomId: string) => {
    props.onClose()
    openChat(roomId)
  }
  const [adding, setAdding] = createSignal(props.mode === "add")
  const [height, setHeight] = createSignal<number>()
  let inner!: HTMLDivElement
  const installs = () => installsFor(props.recipe.slug)
  const here = () => {
    const targets = props.roomId ? targetsForChat(props.roomId) : []
    return targets.length === 1 && !isAdded(props.recipe.slug, targets[0]) ? targets[0] : undefined
  }
  const add = () => {
    const target = here()
    if (target) addToTarget(props.recipe, target, go)
    else setAdding(true)
  }
  onMount(() => {
    void refreshListing()
    const observer = new ResizeObserver(() => setHeight(inner.offsetHeight))
    observer.observe(inner)
    onCleanup(() => observer.disconnect())
  })
  return (
    <Dialog
      open
      onClose={props.onClose}
      size="md"
      data-component="recipe-sheet"
      class="recipe-sheet"
      title={
        <span class="flex items-center gap-3.5 pt-1">
          <span
            class="grid size-12 shrink-0 place-items-center rounded-tile bg-panel"
            style={{ color: `var(--recipe-${props.recipe.tone})` }}
            aria-hidden="true"
          >
            <svg class="size-6" viewBox="0 0 256 256" fill="currentColor" innerHTML={props.recipe.glyph} />
          </span>
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate">{props.recipe.title}</span>
            <span class="type-label flex items-center gap-1.5 truncate text-fg3">
              <RemixIcon icon={ClockIcon} size={16} class="shrink-0" />
              {adding() ? "Choose where it runs" : localizeWhen(props.recipe.when)}
            </span>
          </span>
        </span>
      }
      footer={
        <Show when={!adding()}>
          <button
            type="button"
            class={sheetSecondary}
            data-action="recipe-file"
            disabled={isEditing(props.recipe.slug)}
            onClick={() => void editRecipe(props.recipe.slug, go)}
          >
            Edit recipe
          </button>
          <button type="button" class={primaryButton} data-action="add-recipe" onClick={add}>
            {here() ? "Add to this chat" : "Add to a chat"}
          </button>
        </Show>
      }
    >
      <div class="recipe-sheet-body" style={{ height: height() === undefined ? undefined : `${height()}px` }}>
        <div ref={inner}>
          <Show
            when={!adding()}
            fallback={
              <div class="flex flex-col gap-3">
                <button
                  type="button"
                  class="group type-label -ml-1 flex w-fit cursor-pointer items-center gap-1 rounded-row px-1 py-0.5 text-fg3 transition-colors duration-(--dur-hover) hover:text-fg"
                  data-action="recipe-back"
                  onClick={() => setAdding(false)}
                >
                  <RemixIcon
                    icon={ChevronLeftIcon}
                    size={16}
                    class="transition-transform duration-(--dur-hover) group-hover:-translate-x-0.5"
                  />
                  Back
                </button>
                <AddPicker card={props.recipe} roomId={props.roomId} navigate={go} />
              </div>
            }
          >
            <div class="flex flex-col gap-5">
              <p class="type-ui text-fg">{props.recipe.description}</p>

              <Facts recipe={props.recipe} onConnect={add} />

              <Show when={props.recipe.setup.length}>
                <section class="flex flex-col gap-2" data-component="recipe-setup">
                  <p class={label}>Your agent will ask</p>
                  <div class="flex flex-col items-end gap-1">
                    <For each={props.recipe.setup}>
                      {(q) => (
                        <p class="type-ui max-w-[85%] rounded-bubble rounded-br-tail bg-me px-3 py-2 text-fg">
                          {capital(q)}
                        </p>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={installs().length}>
                <section class="-mx-2.5 flex flex-col gap-0.5" data-component="recipe-installs">
                  <p class={`${label} px-3.5 pb-1`}>Running in</p>
                  <For each={installs()}>
                    {(install) => <InstallRow install={install} card={props.recipe} navigate={go} />}
                  </For>
                </section>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
