import type { RecipeCard } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { cn } from "../lib/cn"
import { Button, fieldClass, muted, Page } from "../settings/kit"
import { filterRecipes, recipeTags, type TagFilter, tagLabel } from "./model"
import { RecipeIcon } from "./recipe-icon"
import { RecipeSheet } from "./sheet"
import { addToKiko, cards, isAdded, refreshListing } from "./state"

/*
 * The recipes page, `/recipes`. It fills the main area the way settings does. A search, a row of
 * tag chips, and a grid of cards. A card opens its sheet; its Add button adds the recipe to Kiko
 * without opening it.
 */
export default function RecipesPage() {
  const navigate = useNavigate()
  const go = (to: string) => navigate(to)
  const [query, setQuery] = createSignal("")
  const [tag, setTag] = createSignal<TagFilter>("all")
  const [open, setOpen] = createSignal<RecipeCard | null>(null)
  const tags = createMemo(() => recipeTags(cards()))
  const shown = createMemo(() => filterRecipes(cards(), query(), tag()))
  onMount(() => void refreshListing())

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 md:px-4 md:pb-4" data-component="recipes-page">
      <div class="@container/recipes flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div class="mx-auto w-full max-w-3xl px-5 py-6 pb-16 max-[767px]:pt-14 @min-[560px]/recipes:px-8 @min-[560px]/recipes:py-8">
          <Page title="Recipes" description="Ready-made habits for your agents.">
            <div class="flex flex-col gap-4" data-component="recipes">
              <div class="flex flex-col gap-3">
                <input type="search" class={fieldClass} placeholder="Search recipes" aria-label="Search recipes" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
                <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
                  <For each={["all", ...tags()]}>
                    {(t) => (
                      <button
                        type="button"
                        aria-pressed={tag() === t}
                        data-tag={t}
                        class={cn(
                          "h-7 cursor-pointer rounded-full border px-3 text-sm",
                          tag() === t ? "border-transparent bg-control-strong text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        onClick={() => setTag(t)}
                      >
                        {t === "all" ? "All" : tagLabel(t)}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <Show when={shown().length} fallback={<p class={cn("px-4 py-6 text-center text-md", muted)}>Nothing matches.</p>}>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2" data-component="recipes-grid">
                  <For each={shown()}>
                    {(card) => (
                      <article class="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4" data-recipe={card.slug}>
                        <button type="button" class="flex flex-col gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-xl" data-action="open-recipe" onClick={() => setOpen(card)}>
                          <RecipeIcon recipe={card} size={44} />
                          <span class="flex flex-col gap-1">
                            <span class="text-md font-medium text-foreground">{card.title}</span>
                            <span class="text-sm leading-relaxed text-muted-foreground">{card.description}</span>
                          </span>
                          <span class={cn("text-xs", muted)}>{card.when}</span>
                          <Show when={card.apps.length}>
                            <span class="flex flex-wrap gap-1">
                              <For each={card.apps}>{(app) => <span class="rounded-md bg-control px-1.5 py-0.5 text-xs text-muted-foreground">{app}</span>}</For>
                            </span>
                          </Show>
                        </button>
                        <div class="relative mt-auto flex justify-end">
                          <Button disabled={isAdded(card.slug)} data-action="add-recipe" onClick={() => addToKiko(card, go)}>
                            {isAdded(card.slug) ? "Added" : "Add"}
                          </Button>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={open()}>{(card) => <RecipeSheet recipe={card()} onClose={() => setOpen(null)} />}</Show>
            </div>
          </Page>
        </div>
      </div>
    </div>
  )
}
