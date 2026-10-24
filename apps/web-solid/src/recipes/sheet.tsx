import type { RecipeCard } from "@kiko/protocol"
import { openChat } from "../app/history"
import { createSignal, For, onMount, Show } from "solid-js"
import { Dialog } from "../lib/dialog"
import { Button, buttonClass } from "../settings/kit"
import { AddPicker } from "./add"
import { AppLogo, RecipeIcon } from "./icon"
import { InstallRow } from "./row"
import { addToTarget, editRecipe, installsFor, isAdded, isEditing, refreshListing, targetsForChat } from "./state"

const label = "px-1 text-[11.5px] font-semibold text-fg3"
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  const installs = () => installsFor(props.recipe.slug)
  const here = () => {
    const targets = props.roomId ? targetsForChat(props.roomId) : []
    return targets.length === 1 && !isAdded(props.recipe.slug, targets[0]) ? targets[0] : undefined
  }
  onMount(() => void refreshListing())
  return (
    <Dialog
      open
      onClose={props.onClose}
      data-component="recipe-sheet"
      class="[--recipe-surface:var(--raise)]"
      title={
        <span class="flex items-center gap-3.5 pt-1">
          <RecipeIcon recipe={props.recipe} size={52} stickers />
          <span class="flex min-w-0 flex-col gap-0.5 pl-1">
            <span class="truncate text-[17px] font-semibold tracking-[-0.01em]">{props.recipe.title}</span>
            <span class="truncate text-[12.5px] font-normal text-fg3">
              {adding() ? "Choose where it runs" : props.recipe.when}
            </span>
          </span>
        </span>
      }
      footer={
        <Show when={!adding()}>
          <Button
            variant="ghost"
            class="mr-auto rounded-full"
            data-action="recipe-file"
            busy={isEditing(props.recipe.slug)}
            onClick={() => void editRecipe(props.recipe.slug, go)}
          >
            Edit recipe
          </Button>
          <button
            type="button"
            class={buttonClass("primary", "rounded-full px-4")}
            data-action="add-recipe"
            onClick={() => {
              const target = here()
              if (target) addToTarget(props.recipe, target, go)
              else setAdding(true)
            }}
          >
            {here() ? "Add to this chat" : "Add to a chat"}
          </button>
        </Show>
      }
    >
      <Show when={!adding()} fallback={<AddPicker card={props.recipe} roomId={props.roomId} navigate={go} />}>
        <div class="flex flex-col gap-5">
          <p class="text-[14px] leading-relaxed text-fg">{props.recipe.description}</p>

          <Show when={props.recipe.apps.length}>
            <section class="flex flex-col gap-1.5" data-component="recipe-apps">
              <h3 class={label}>Uses</h3>
              <For each={props.recipe.apps}>
                {(app) => (
                  <div class="flex items-center gap-3 px-1 py-1" data-app={app.slug}>
                    <AppLogo app={app} size={26} />
                    <span class="min-w-0 flex-1 truncate text-sm text-fg">{app.name}</span>
                    <Show when={app.connected}>
                      <span class="shrink-0 text-xs text-ok">Connected</span>
                    </Show>
                  </div>
                )}
              </For>
            </section>
          </Show>

          <Show when={props.recipe.setup.length}>
            <section class="flex flex-col gap-1.5" data-component="recipe-setup">
              <h3 class={label}>Your agent will ask</h3>
              <div class="flex flex-col items-start gap-1">
                <For each={props.recipe.setup}>
                  {(q) => (
                    <p class="max-w-[85%] rounded-[14px] rounded-bl-[4px] bg-panel px-3 py-2 text-[13.5px] leading-snug text-fg">
                      {capital(q)}
                    </p>
                  )}
                </For>
              </div>
            </section>
          </Show>

          <Show when={installs().length}>
            <section class="-mx-2.5 flex flex-col gap-0.5" data-component="recipe-installs">
              <h3 class={`${label} px-3.5 pb-1`}>Running in</h3>
              <For each={installs()}>
                {(install) => <InstallRow install={install} card={props.recipe} navigate={go} />}
              </For>
            </section>
          </Show>
        </div>
      </Show>
    </Dialog>
  )
}
