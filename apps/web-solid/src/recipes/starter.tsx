import type { RecipeCard } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { MoreIcon } from "@kiko/ui/icons"
import { A } from "@solidjs/router"
import { createSignal, For, Show } from "solid-js"
import { RECIPES } from "./catalog.gen"
import { starterTiles } from "./model"
import { RecipeIcon } from "./recipe-icon"
import { RecipeSheet } from "./sheet"

/*
 * The recipes an empty chat offers, under its heading. Loaded lazily by the chat's empty state, so
 * the catalog stays out of the first paint of /chat.
 */
export default function RecipeStarter() {
  const [open, setOpen] = createSignal<RecipeCard | null>(null)
  const tiles = starterTiles(RECIPES)
  return (
    <div class="mt-3 flex flex-col items-center gap-3" data-component="recipe-starter">
      <p class="text-sm text-muted-foreground">Or start from a recipe</p>
      <div class="flex max-w-md flex-wrap justify-center gap-4">
        <For each={tiles}>
          {(card) => (
            <button type="button" class="flex w-20 cursor-pointer flex-col items-center gap-1.5 outline-none" data-recipe={card.slug} onClick={() => setOpen(card)}>
              <RecipeIcon recipe={card} size={56} />
              <span class="text-center text-xs leading-4 text-muted-foreground">{card.title}</span>
            </button>
          )}
        </For>
        <A href="/settings/recipes" class="flex w-20 flex-col items-center gap-1.5 outline-none" data-action="all-recipes">
          <span class="grid size-14 place-items-center rounded-full bg-control text-muted-foreground">
            <HugeIcon icon={MoreIcon} size={20} />
          </span>
          <span class="text-center text-xs leading-4 text-muted-foreground">All recipes</span>
        </A>
      </div>
      <Show when={open()}>{(card) => <RecipeSheet recipe={card()} onClose={() => setOpen(null)} />}</Show>
    </div>
  )
}
