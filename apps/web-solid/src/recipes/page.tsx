import { EmptyArt } from "../components/empty-art"
import type { RecipeCard } from "@kiko/protocol"
import { getRouteApi } from "@tanstack/solid-router"
import { openChat } from "../app/history"
import { createMemo, createSignal, For, type JSX, Show } from "solid-js"
import { pageIn } from "../lib/motion"
import { room } from "../state/room"
import { PageFrame, PageSearch, PageTabs, SectionHead, SkeletonRows } from "../customize/page-ui"
import { byChatOrder, filterRecipes, openingSection, recipeTags, type Section, type TagFilter, tagLabel } from "./model"
import { InstallCard } from "./row"
import { ConnectSheet } from "./connect"
import { NewRecipe } from "./new-recipe"
import { RecipeSheet } from "./sheet"
import {
  addToTarget,
  broken,
  cards,
  connectAsk,
  followRecipes,
  installs,
  isAdded,
  knownInstalls,
  targetsForChat,
} from "./state"
import { RecipeTile } from "./tile"

const tagTab =
  "type-sm h-control-lg shrink-0 cursor-pointer rounded-full px-3 text-tertiary transition-colors duration-(--duration-fast) hover:bg-tertiary hover:text-primary aria-selected:bg-secondary aria-selected:text-primary"
const grid = "grid grid-cols-1 gap-x-4 gap-y-1 @min-[640px]/page:grid-cols-2"

function Empty(props: { title: string; children?: JSX.Element }) {
  return (
    <div class="flex flex-col items-center gap-2 px-6 py-14 text-center" data-component="recipes-no-match">
      <EmptyArt name="search" />
      <p class="type-base text-secondary">{props.title}</p>
      {props.children}
    </div>
  )
}

const route = getRouteApi("/_chat/recipes")

export default function RecipesPage() {
  const roomId = route.useSearch({ select: (search) => search.room })
  const [query, setQuery] = createSignal("")
  const [tag, setTag] = createSignal<TagFilter>("all")
  const [open, setOpen] = createSignal<{ card: RecipeCard; mode?: "add" } | null>(null)
  const bySlug = createMemo(() => new Map(cards().map((c) => [c.slug, c])))
  const matching = createMemo(() => new Set(filterRecipes(cards(), query(), "all").map((c) => c.slug)))
  const yours = createMemo(() =>
    byChatOrder(
      installs().filter((i) => matching().has(i.slug)),
      room.bots().map((b) => b.id),
    ),
  )
  const tags = createMemo(() => ["all", ...recipeTags(cards())])
  const shown = createMemo(() => filterRecipes(cards(), query(), tag()))
  const [picked, setSection] = createSignal<Section | null>(null)
  const opening = createMemo<Section | undefined>((settled) => settled ?? openingSection(knownInstalls(), !!roomId()))
  const section = () => picked() ?? opening()
  const add = (card: RecipeCard) => {
    const id = roomId()
    const targets = id ? targetsForChat(id) : []
    if (targets.length === 1 && !isAdded(card.slug, targets[0])) addToTarget(card, targets[0], openChat)
    else setOpen({ card, mode: "add" })
  }
  followRecipes()
  const fresh = createMemo(() => {
    const have = new Set(yours().map((i) => i.slug))
    return filterRecipes(cards(), query(), "all").filter((c) => !have.has(c.slug))
  })

  return (
    <PageFrame title="Recipes">
      <div class="flex flex-col gap-6 pt-4" data-component="recipes-page">
        <Show when={section()} fallback={<SkeletonRows count={3} />}>
          {(current) => (
            <>
              <div class="flex items-center justify-between gap-3">
                <PageTabs
                  label="Recipes"
                  value={current()}
                  onChange={(next) => setSection(next as Section)}
                  options={[
                    { value: "yours", label: "Yours", "data-section": "yours" },
                    { value: "discover", label: "Templates", "data-section": "discover" },
                  ]}
                  data-component="recipes-sections"
                />
                <div class="flex items-center gap-1">
                  <PageSearch label="Search recipes" query={query()} onQuery={setQuery} />
                  <NewRecipe />
                </div>
              </div>

              <Show when={current() === "yours"}>
                <div ref={pageIn} class="flex flex-col gap-8" data-component="recipes-yours">
                  <Show
                    when={yours().length}
                    fallback={
                      <Show when={!query()} fallback={<Empty title="Nothing of yours matches" />}>
                        <div
                          class="flex flex-col items-center gap-4 rounded-xl bg-editor px-6 py-10 text-center"
                          data-component="recipes-empty"
                        >
                          <EmptyArt name="pot" size={140} />
                          <div class="flex flex-col gap-1">
                            <p class="type-base text-secondary">No recipes yet</p>
                            <p class="type-sm max-w-[320px] text-tertiary">
                              Recipes are jobs your team runs on a schedule or when something happens.
                            </p>
                          </div>
                          <NewRecipe />
                        </div>
                      </Show>
                    }
                  >
                    <div class="flex flex-col gap-1">
                      <For each={yours()}>
                        {(install) => <InstallCard install={install} card={bySlug().get(install.slug)!} />}
                      </For>
                    </div>
                  </Show>
                  <Show when={fresh().length}>
                    <section class="flex flex-col gap-2">
                      <SectionHead
                        title={yours().length ? "More from templates" : "Start from a template"}
                        onAll={() => setSection("discover")}
                        allLabel={yours().length ? "See all" : "Show all"}
                      />
                      <div class={grid}>
                        <For each={fresh().slice(0, 6)}>
                          {(card) => (
                            <RecipeTile recipe={card} onOpen={() => setOpen({ card })} onAdd={() => add(card)} />
                          )}
                        </For>
                      </div>
                    </section>
                  </Show>
                </div>
              </Show>

              <Show when={current() === "discover"}>
                <div ref={pageIn} class="flex flex-col gap-4" data-component="recipes">
                  <div
                    class="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
                    role="tablist"
                    aria-label="Categories"
                    data-component="recipes-tags"
                  >
                    <For each={tags()}>
                      {(t) => (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={tag() === t}
                          class={tagTab}
                          data-tag={t}
                          onClick={() => setTag(t)}
                        >
                          {t === "all" ? "All" : tagLabel(t)}
                        </button>
                      )}
                    </For>
                  </div>

                  <Show when={broken().length}>
                    <div
                      class="flex flex-col gap-1 type-sm rounded-xl bg-editor px-4 py-3 text-tertiary"
                      data-component="recipes-broken"
                    >
                      <p class="font-medium text-primary">Some recipe files did not load</p>
                      <For each={broken()}>{(why) => <p>{why}</p>}</For>
                    </div>
                  </Show>

                  <Show when={shown().length} fallback={<Empty title="Nothing matches" />}>
                    <div class={grid} data-component="recipes-grid">
                      <For each={shown()}>
                        {(card) => (
                          <RecipeTile recipe={card} onOpen={() => setOpen({ card })} onAdd={() => add(card)} />
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </>
          )}
        </Show>

        <Show
          when={connectAsk()}
          fallback={
            <Show when={open()}>
              {(o) => <RecipeSheet roomId={roomId()} recipe={o().card} mode={o().mode} onClose={() => setOpen(null)} />}
            </Show>
          }
        >
          <ConnectSheet />
        </Show>
      </div>
    </PageFrame>
  )
}
