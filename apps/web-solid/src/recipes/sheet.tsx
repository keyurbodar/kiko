import type { RecipeCard } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { createSignal, For, Show } from "solid-js"
import { useApp } from "../lib/store"
import { Dialog } from "../lib/dialog"
import { Button, muted } from "../settings/kit"
import { sheetLine } from "./model"
import { RecipeIcon } from "./recipe-icon"
import { addOwnChat, addToTarget, isAdded, isOwning, openRecipeFile, installsFor, removeInstall, targetFor, type RecipeTarget } from "./state"

/*
 * A recipe's sheet: the icon, the title, what it does, when and with what, and one add. The
 * dialog's own header holds only the title, for screen readers, so the look is the icon first.
 */
export function RecipeSheet(props: { recipe: RecipeCard; onClose: () => void; roomId?: string | null }) {
  const navigate = useNavigate()
  const go = (to: string) => { props.onClose(); navigate(to) }
  const [chosen, setChosen] = createSignal<string>()
  const target = (): RecipeTarget | undefined => {
    const base = targetFor(props.roomId)
    const member = useApp.roomMembers().find((m) => m.slug === chosen())
    return base && member ? { ...base, agent: member.slug, name: member.name } : base
  }
  return (
    <Dialog open onClose={props.onClose} title={<span class="sr-only">{props.recipe.title}</span>} data-component="recipe-sheet">
      <div class="flex flex-col items-center gap-3 pt-2 text-center">
        <RecipeIcon recipe={props.recipe} size={96} />
        <p class="text-lg font-semibold leading-snug text-foreground">{props.recipe.title}</p>
        <p class="text-md leading-relaxed text-muted-foreground">{props.recipe.description}</p>
        <p class={`text-sm ${muted}`}>{sheetLine(props.recipe)}</p>
        <Show when={props.roomId && useApp.roomMembers().length > 1}>
          <label class="flex w-full items-center justify-between text-sm text-muted-foreground">
            Add for
            <select aria-label="Recipe agent" class="rounded-md bg-control px-2 py-1 text-foreground" value={target()?.agent} onChange={(e) => setChosen(e.currentTarget.value)}>
              <For each={useApp.roomMembers()}>{(m) => <option value={m.slug}>{m.name}</option>}</For>
            </select>
          </label>
        </Show>
        <Button variant="primary" class="mt-2 w-full" data-action="add-recipe" disabled={isAdded(props.recipe.slug, target())} onClick={() => addToTarget(props.recipe, target(), go)}>
          {isAdded(props.recipe.slug, target()) ? "Added" : `Add to ${target()?.name ?? "Kiko"}`}
        </Button>
        <button
          type="button"
          class="cursor-pointer text-sm text-muted-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          data-action="recipe-own-chat"
          disabled={isOwning(props.recipe.slug)}
          onClick={() => addOwnChat(props.recipe, go)}
        >
          {isOwning(props.recipe.slug) ? "Making its chat" : "or give it its own chat"}
        </button>
        <Show when={installsFor(props.recipe.slug).length}>
          <div class="mt-2 flex w-full flex-col gap-2 text-left" data-component="recipe-installs">
            <p class="text-xs text-muted-foreground">{`Used in ${installsFor(props.recipe.slug).length} ${installsFor(props.recipe.slug).length === 1 ? "place" : "places"}`}</p>
            <For each={installsFor(props.recipe.slug)}>{(install) => (
              <div class="flex items-center justify-between gap-3 text-sm">
                <button type="button" class="min-w-0 cursor-pointer truncate text-left" onClick={() => go(`/chat/${install.roomId}`)}>
                  @{install.agent === "yuki" ? "Kiko" : install.agent} · {useApp.chatById(install.roomId)?.name ?? "Chat"}
                </button>
                <button type="button" class="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={`Remove recipe for ${install.agent}`} onClick={() => removeInstall(install)}>Remove</button>
              </div>
            )}</For>
            <p class="text-xs text-muted-foreground">Each has its own routines. Removing one leaves the others running.</p>
          </div>
        </Show>
        <button type="button" class="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline" data-action="recipe-file" onClick={() => openRecipeFile(props.recipe.slug, go)}>
          View or edit its file
        </button>
      </div>
    </Dialog>
  )
}
