import type { RecipeCard } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { SearchIcon } from "@kiko/ui/icons"
import { TabsV2 } from "@kiko/ui/v2/tabs-v2"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, type JSX, onMount, Show } from "solid-js"
import { useApp } from "../lib/store"
import { buttonClass } from "../settings/kit"
import { byChatOrder, filterRecipes, recipeTags, type TagFilter, tagLabel } from "./model"
import { InstallCard } from "./row"
import { ConnectSheet } from "./connect"
import { RecipeSheet } from "./sheet"
import { addToTarget, broken, connectAsk, cards, installs, isAdded, refreshListing, targetsForChat } from "./state"
import { RecipeTile } from "./tile"

type Section = "yours" | "discover"

const sectionTab =
  "flex h-8 cursor-pointer items-center gap-2 rounded-full pr-2 pl-3.5 text-[14px] font-medium text-muted-foreground hover:text-foreground data-[selected]:bg-control-strong data-[selected]:text-foreground"
const tagTab =
  "h-7 shrink-0 cursor-pointer rounded-full px-3 text-[13px] text-muted-foreground hover:bg-control hover:text-foreground data-[selected]:bg-control-strong data-[selected]:text-foreground"
const grid = "grid grid-cols-1 gap-3 @max-[519px]/recipes:gap-2 @min-[520px]/recipes:grid-cols-2"

function Empty(props: { title: string; children?: JSX.Element }) {
  return (
    <div class="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <p class="text-[15px] font-medium text-foreground">{props.title}</p>
      {props.children}
    </div>
  )
}

/*
 * The recipes page, `/recipes`. Two tabs: "Yours" shows what runs now, "Discover" is the book, with
 * its categories as a second row of tabs. Both rows stick to the top, so any of it is one click
 * away. Search filters both tabs. `?room=` is the chat the human came from, so Add goes there first.
 */
export default function RecipesPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const roomId = () => (typeof params.room === "string" ? params.room : undefined)
  createEffect(() => {
    const id = roomId()
    if (id) useApp.selectThread(id)
  })
  const [query, setQuery] = createSignal("")
  const [tag, setTag] = createSignal<TagFilter>("all")
  const [open, setOpen] = createSignal<{ card: RecipeCard; mode?: "add" } | null>(null)
  const bySlug = createMemo(() => new Map(cards().map((c) => [c.slug, c])))
  const matching = createMemo(() => new Set(filterRecipes(cards(), query(), "all").map((c) => c.slug)))
  const yours = createMemo(() => byChatOrder(installs().filter((i) => matching().has(i.slug)), useApp.bots().map((b) => b.id)))
  const tags = createMemo(() => ["all", ...recipeTags(cards())])
  // Only the selected category's panel is mounted, so one list serves every panel.
  const shown = createMemo(() => filterRecipes(cards(), query(), tag()))
  const [section, setSection] = createSignal<Section>(installs().length && !roomId() ? "yours" : "discover")
  const add = (card: RecipeCard) => {
    const id = roomId()
    const targets = id ? targetsForChat(id) : []
    if (targets.length === 1 && !isAdded(card.slug, targets[0])) addToTarget(card, targets[0], navigate)
    else setOpen({ card, mode: "add" })
  }
  onMount(() => void refreshListing())

  let scroller!: HTMLDivElement
  let tabsTop!: HTMLDivElement
  // A switch from far down the page lands at the top of the new list, with the tabs still in view.
  const toTabs = () => {
    const y = tabsTop.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    if (scroller.scrollTop > y) scroller.scrollTop = y
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-component="recipes-page">
      <div ref={scroller} class="@container/recipes flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div class="mx-auto flex w-full max-w-[880px] flex-col px-5 pb-20 @min-[560px]/recipes:px-8">
          <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-8 pb-4 max-[767px]:pt-14 @min-[560px]/recipes:pt-10">
            <div class="flex flex-col gap-1">
              <h1 class="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Recipes</h1>
              <p class="text-[14px] text-muted-foreground">Little routines your agents can pick up.</p>
            </div>
            <label class="flex h-9 w-full items-center gap-2 rounded-full bg-control px-3.5 text-muted-foreground @min-[560px]/recipes:w-64">
              <HugeIcon icon={SearchIcon} size={15} />
              <input
                type="search"
                class="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Search recipes"
                aria-label="Search recipes"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
            </label>
          </header>

          <div ref={tabsTop} />
          <TabsV2
            value={section()}
            onChange={(next) => {
              setSection(next as Section)
              toTabs()
            }}
          >
            <TabsV2.List class="sticky top-0 z-10 -mx-1 flex h-14 items-center gap-1 bg-background px-1" aria-label="Recipes" data-component="recipes-sections">
              <TabsV2.Trigger value="yours" class={sectionTab} data-section="yours">
                Yours
                <span class="min-w-5 rounded-full bg-control px-1.5 text-center text-[11.5px] leading-5 tabular-nums">{yours().length}</span>
              </TabsV2.Trigger>
              <TabsV2.Trigger value="discover" class={sectionTab} data-section="discover">
                Discover
                <span class="min-w-5 rounded-full bg-control px-1.5 text-center text-[11.5px] leading-5 tabular-nums">{matching().size}</span>
              </TabsV2.Trigger>
            </TabsV2.List>

            <TabsV2.Content value="yours" class="pt-2 outline-none" data-component="recipes-yours">
              <Show
                when={yours().length}
                fallback={
                  <Show when={!query()} fallback={<Empty title="Nothing of yours matches" />}>
                    <Empty title="Nothing runs yet">
                      <p class="max-w-[320px] text-[13.5px] text-muted-foreground">Recipes you add show up here, with when each one runs next.</p>
                      <button type="button" class={buttonClass("primary", "mt-3 rounded-full px-4")} onClick={() => setSection("discover")}>
                        Browse recipes
                      </button>
                    </Empty>
                  </Show>
                }
              >
                <div class={grid}>
                  <For each={yours()}>{(install) => <InstallCard install={install} card={bySlug().get(install.slug)!} />}</For>
                </div>
              </Show>
            </TabsV2.Content>

            <TabsV2.Content value="discover" class="outline-none" data-component="recipes">
              <TabsV2
                value={tag()}
                onChange={(next) => {
                  setTag(next)
                  toTabs()
                }}
              >
                <div class="sticky top-14 z-10 -mx-1 bg-background px-1 pb-3">
                  <TabsV2.List
                    class="flex items-center gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)] [scrollbar-width:none]"
                    aria-label="Categories"
                    data-component="recipes-tags"
                  >
                    <For each={tags()}>
                      {(t) => (
                        <TabsV2.Trigger value={t} class={tagTab} data-tag={t}>
                          {t === "all" ? "All" : tagLabel(t)}
                        </TabsV2.Trigger>
                      )}
                    </For>
                  </TabsV2.List>
                </div>

                <Show when={broken().length}>
                  <div class="mb-3 flex flex-col gap-1 rounded-[16px] bg-card px-4 py-3 text-[13px] text-muted-foreground" data-component="recipes-broken">
                    <p class="font-medium text-foreground">Some recipe files did not load</p>
                    <For each={broken()}>{(why) => <p>{why}</p>}</For>
                  </div>
                </Show>

                <For each={tags()}>
                  {(t) => (
                    <TabsV2.Content value={t} class="outline-none">
                      <Show when={shown().length} fallback={<Empty title="Nothing matches" />}>
                        <div class={`${grid} @min-[760px]/recipes:grid-cols-3`} data-component="recipes-grid">
                          <For each={shown()}>{(card) => <RecipeTile recipe={card} onOpen={() => setOpen({ card })} onAdd={() => add(card)} />}</For>
                        </div>
                      </Show>
                    </TabsV2.Content>
                  )}
                </For>
              </TabsV2>
            </TabsV2.Content>
          </TabsV2>

          <Show when={connectAsk()} fallback={<Show when={open()}>{(o) => <RecipeSheet roomId={roomId()} recipe={o().card} mode={o().mode} onClose={() => setOpen(null)} />}</Show>}>
            <ConnectSheet />
          </Show>
        </div>
      </div>
    </div>
  )
}
