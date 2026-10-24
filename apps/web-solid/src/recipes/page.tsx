import type { RecipeCard } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, SearchIcon } from "@kiko/ui/icons"
import { getRouteApi } from "@tanstack/solid-router"
import { openChat } from "../app/history"
import { createMemo, createSignal, For, type JSX, Show } from "solid-js"
import { room } from "../state/room"
import { PageFrame, PageTabs, SectionHead, SkeletonRows, ToolButton } from "../customize/page-ui"
import { byChatOrder, filterRecipes, openingSection, recipeTags, type Section, type TagFilter, tagLabel } from "./model"
import { InstallCard } from "./row"
import { ConnectSheet } from "./connect"
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
  "h-7 shrink-0 cursor-pointer rounded-full px-3 text-[13px] text-fg3 transition-colors duration-[var(--dur-hover)] hover:bg-hover hover:text-fg aria-selected:bg-active aria-selected:text-fg"
const grid = "grid grid-cols-1 gap-x-4 gap-y-1 @min-[640px]/page:grid-cols-2"

function Empty(props: { title: string; children?: JSX.Element }) {
  return (
    <div class="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p class="text-[15px] text-fg2">{props.title}</p>
      {props.children}
    </div>
  )
}

const route = getRouteApi("/recipes")

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
  const [searching, setSearching] = createSignal(false)
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
  let search: HTMLInputElement | undefined
  const toggleSearch = () => {
    const next = !searching()
    setSearching(next)
    if (next) queueMicrotask(() => search?.focus())
    else setQuery("")
  }

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
                  <Show when={searching()}>
                    <label class="flex h-8 w-[min(240px,50vw)] items-center gap-2 rounded-[9px] bg-panel px-3 text-fg3">
                      <RemixIcon icon={SearchIcon} size={15} />
                      <input
                        ref={search}
                        type="search"
                        class="min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg4"
                        placeholder="Search recipes"
                        aria-label="Search recipes"
                        value={query()}
                        onInput={(e) => setQuery(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === "Escape" && toggleSearch()}
                      />
                    </label>
                  </Show>
                  <ToolButton
                    label={searching() ? "Close search" : "Search recipes"}
                    icon={searching() ? CloseIcon : SearchIcon}
                    onClick={toggleSearch}
                  />
                </div>
              </div>

              <Show when={current() === "yours"}>
                <div class="motion-page-in flex flex-col gap-8" data-component="recipes-yours">
                  <Show
                    when={yours().length}
                    fallback={
                      <Show when={!query()} fallback={<Empty title="Nothing of yours matches" />}>
                        <Empty title="No recipes yet. Your team is free." />
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
                <div class="motion-page-in flex flex-col gap-4" data-component="recipes">
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
                      class="flex flex-col gap-1 rounded-[16px] bg-panel px-4 py-3 text-[13px] text-fg3"
                      data-component="recipes-broken"
                    >
                      <p class="font-medium text-fg">Some recipe files did not load</p>
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
