import type { RecipeCard } from "@kiko/protocol"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useApp } from "../lib/store"
import { cn } from "../lib/cn"
import { fieldClass, muted, Page } from "../settings/kit"
import { filterRecipes, recipeTags, type TagFilter, tagLabel } from "./model"
import { RecipeTile } from "./card"
import { RecipeSheet } from "./sheet"
import { addToTarget, broken, cards, refreshListing, installsFor, isAdded, targetsForChat } from "./state"

/*
 * The recipes page, `/recipes`. It fills the main area the way settings does. A search, a row of
 * tag chips, and a grid of cards. Cards open details. Add opens a chat picker, or uses the current single-agent chat.
 */
export default function RecipesPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const roomId = () => typeof params.room === "string" ? params.room : undefined
  createEffect(() => { const id = roomId(); if (id) useApp.selectThread(id) })
  const go = (to: string) => navigate(to)
  const [query, setQuery] = createSignal("")
  const [tag, setTag] = createSignal<TagFilter>("all")
  const [open, setOpen] = createSignal<{ card: RecipeCard; mode?: "add"; agent?: string } | null>(null)
  const add = (card: RecipeCard) => {
    const id = roomId()
    const targets = id ? targetsForChat(id) : []
    if (targets.length === 1 && !isAdded(card.slug, targets[0])) addToTarget(card, targets[0], go)
    else setOpen({ card, mode: "add" })
  }
  const tags = createMemo(() => recipeTags(cards()))
  const shown = createMemo(() => filterRecipes(cards(), query(), tag()).filter((card) => params.view !== "installed" || installsFor(card.slug).length > 0))
  onMount(() => void refreshListing())

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 md:px-4 md:pb-4" data-component="recipes-page">
      <div class="@container/recipes flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div class="mx-auto w-full max-w-7xl px-5 py-6 pb-16 max-[767px]:pt-14 @min-[560px]/recipes:px-8 @min-[560px]/recipes:py-8">
          <Page title={params.view === "installed" ? "In use" : "Recipes"} description={params.view === "installed" ? "The recipes your agents are using." : "Give your agents something new to do."}>
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

              <Show when={broken().length}>
                <div class="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground" data-component="recipes-broken">
                  <For each={broken()}>{(why) => <p>{why}</p>}</For>
                </div>
              </Show>

              <Show when={shown().length} fallback={<p class={cn("px-4 py-6 text-center text-md", muted)}>Nothing matches.</p>}>
                <div class="grid grid-cols-1 gap-3 @min-[500px]/recipes:grid-cols-2 @min-[850px]/recipes:grid-cols-3 @min-[1180px]/recipes:grid-cols-4" data-component="recipes-grid">
                  <For each={shown()}>
                    {(card) => (
                      <RecipeTile recipe={card} onOpen={(agent) => setOpen({ card, agent })} onAdd={() => add(card)} />
                    )}
                  </For>
                </div>
              </Show>

              <Show when={open()}>{(card) => <RecipeSheet roomId={roomId()} recipe={card().card} mode={card().mode} agent={card().agent} onClose={() => setOpen(null)} />}</Show>
            </div>
          </Page>
        </div>
      </div>
    </div>
  )
}
