import type { RecipeCard } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChevronRightIcon, SearchIcon } from "@kiko/ui/icons"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { cn } from "../lib/cn"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { filterRecipes, groupByChat, recipeTags, type TagFilter, tagLabel } from "./model"
import { InstallRow } from "./row"
import { RecipeSheet } from "./sheet"
import { addToTarget, broken, cards, installs, isAdded, refreshListing, targetsForChat } from "./state"
import { RecipeTile } from "./tile"

const names = (list: readonly string[]) => (list.length < 3 ? list.join(" and ") : `${list.slice(0, -1).join(", ")}, and ${list.at(-1)}`)
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/*
 * The recipes page, `/recipes`. "Yours" shows what runs now, one card per chat. "Discover" is the
 * book. `?room=` is the chat the human came from, so Add goes there first.
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
  const groups = createMemo(() => groupByChat(installs().filter((i) => bySlug().has(i.slug)), useApp.bots().map((b) => b.id)))
  const tags = createMemo(() => recipeTags(cards()))
  const shown = createMemo(() => filterRecipes(cards(), query(), tag()))
  const add = (card: RecipeCard) => {
    const id = roomId()
    const targets = id ? targetsForChat(id) : []
    if (targets.length === 1 && !isAdded(card.slug, targets[0])) addToTarget(card, targets[0], navigate)
    else setOpen({ card, mode: "add" })
  }
  onMount(() => void refreshListing())

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-component="recipes-page">
      <div class="@container/recipes flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div class="mx-auto flex w-full max-w-[880px] flex-col gap-9 px-5 pt-8 pb-20 max-[767px]:pt-14 @min-[560px]/recipes:px-8 @min-[560px]/recipes:pt-10">
          <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
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

          <Show when={groups().length && !query()}>
            <section class="flex flex-col gap-3" data-component="recipes-yours">
              <div class="flex items-baseline gap-2.5 px-1">
                <h2 class="text-[15px] font-semibold text-foreground">Yours</h2>
                <span class="text-[13px] text-muted-foreground">
                  {count(groups().reduce((n, g) => n + g.installs.length, 0), "recipe", "recipes")} in {count(groups().length, "chat", "chats")}
                </span>
              </div>
              <div class="gap-3 @min-[760px]/recipes:columns-2">
                <For each={groups()}>
                  {(group) => {
                    const chat = () => useApp.chatById(group.roomId)
                    const members = () => targetsForChat(group.roomId)
                    return (
                      <div class="mb-3 flex break-inside-avoid flex-col rounded-[18px] bg-card p-1.5 [--recipe-surface:var(--card)]" data-chat={group.roomId}>
                        <div class="flex items-center gap-2.5 px-2.5 pt-2 pb-1.5">
                          <ChatAvatar faces={useApp.chatFaces(group.roomId)} size={28} />
                          <span class="min-w-0 flex-1">
                            <span class="block truncate text-[13.5px] font-semibold text-foreground">{chat()?.name ?? "Chat"}</span>
                            <Show when={members().length > 1 && chat()?.name !== members().map((m) => m.name).join(", ")}>
                              <span class="block truncate text-xs text-muted-foreground">{names(members().map((m) => m.name))}</span>
                            </Show>
                          </span>
                          <button
                            type="button"
                            class="flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-full pr-2 pl-3 text-xs text-muted-foreground hover:bg-control hover:text-foreground"
                            data-action="open-chat"
                            onClick={() => navigate(`/chat/${group.roomId}`)}
                          >
                            Open chat
                            <HugeIcon icon={ChevronRightIcon} size={13} />
                          </button>
                        </div>
                        <For each={group.installs}>{(install) => <InstallRow install={install} card={bySlug().get(install.slug)!} lead="recipe" />}</For>
                      </div>
                    )
                  }}
                </For>
              </div>
            </section>
          </Show>

          <section class="flex flex-col gap-4" data-component="recipes">
            <div class="flex flex-col gap-3 px-1">
              <h2 class="text-[15px] font-semibold text-foreground">Discover</h2>
              <div class="-mx-1 flex flex-wrap gap-1" role="group" aria-label="Filter by tag">
                <For each={["all", ...tags()]}>
                  {(t) => (
                    <button
                      type="button"
                      aria-pressed={tag() === t}
                      data-tag={t}
                      class={cn("h-7 cursor-pointer rounded-full px-3 text-[13px]", tag() === t ? "bg-control-strong text-foreground" : "text-muted-foreground hover:bg-control hover:text-foreground")}
                      onClick={() => setTag(t)}
                    >
                      {t === "all" ? "All" : tagLabel(t)}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <Show when={broken().length}>
              <div class="flex flex-col gap-1 rounded-[16px] bg-card px-4 py-3 text-[13px] text-muted-foreground" data-component="recipes-broken">
                <p class="font-medium text-foreground">Some recipe files did not load</p>
                <For each={broken()}>{(why) => <p>{why}</p>}</For>
              </div>
            </Show>

            <Show when={shown().length} fallback={<p class="px-1 py-10 text-center text-sm text-muted-foreground">Nothing matches.</p>}>
              <div class="grid grid-cols-1 gap-3 @max-[519px]/recipes:gap-0.5 @min-[520px]/recipes:grid-cols-2 @min-[760px]/recipes:grid-cols-3" data-component="recipes-grid">
                <For each={shown()}>{(card) => <RecipeTile recipe={card} onOpen={() => setOpen({ card })} onAdd={() => add(card)} />}</For>
              </div>
            </Show>
          </section>

          <Show when={open()}>{(o) => <RecipeSheet roomId={roomId()} recipe={o().card} mode={o().mode} onClose={() => setOpen(null)} />}</Show>
        </div>
      </div>
    </div>
  )
}
