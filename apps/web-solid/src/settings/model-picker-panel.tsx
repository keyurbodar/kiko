import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js"
import { openSettings } from "./open"
import { createQuery } from "../state/runtime"
import { Portal } from "solid-js/web"
import { VList, type VListHandle } from "virtua/solid"
import { formatContext, formatPrice, catalogQuery, modelRef, searchModels, type ModelRow } from "./catalog"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ArrowUpIcon, CheckIcon, EnterIcon, SearchIcon } from "@kiko/ui/icons"
import type { ThinkingLevel } from "@kiko/protocol"
import { connectedProviders } from "./connected"
import { favoriteModels, hiddenModels, toggleFavorite } from "./model-prefs"
import { modelProviders } from "./provider-kinds"
import { PROBLEM_SHORT } from "./provider-problem"
import { placePanel } from "../lib/place-panel"

const ROW_H = 44
const PANEL_W = 420
const PANEL_H = 380
const FAVORITES = "favorites"

function Star(props: { on: boolean }) {
  return (
    <svg
      class="size-3.5"
      viewBox="0 0 16 16"
      fill={props.on ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  )
}

export default function ModelPickerPanel(props: {
  current?: string
  onPick: (ref: string, thinking: readonly ThinkingLevel[]) => void
  onOpenChange: (open: boolean) => void
  trigger: () => HTMLButtonElement | undefined
}) {
  const catalog = createQuery(catalogQuery)
  const providers = createMemo(() => {
    const ids = new Set(modelProviders(connectedProviders()).map((p) => p.provider))
    return catalog()?.providers.filter((p) => ids.has(p.id)) ?? []
  })
  const problemOf = (id: string) => connectedProviders().find((p) => p.provider === id)?.problem
  const [picked, setRail] = createSignal<string | null>(null)
  const rail = () => {
    if (picked()) return picked()!
    if (favoriteModels().length) return FAVORITES
    const current = props.current?.split("/")[0]
    return providers().find((p) => p.id === current)?.id ?? providers()[0]?.id ?? FAVORITES
  }
  const [query, setQuery] = createSignal("")
  const [at, setAt] = createSignal(0)
  const [place, setPlace] = createSignal<JSX.CSSProperties>({})
  const [handle, setHandle] = createSignal<VListHandle>()
  const id = createUniqueId()
  let panel: HTMLDivElement | undefined

  const rows = createMemo((): ModelRow[] => {
    const hidden = new Set(hiddenModels())
    const visible = (r: ModelRow) => {
      const ref = modelRef(r.provider.id, r.model.id)
      return !hidden.has(ref) || ref === props.current
    }
    if (query().trim()) return searchModels(providers(), query()).filter(visible)
    if (rail() === FAVORITES) {
      const starred = new Set(favoriteModels())
      return searchModels(providers(), "").filter((r) => starred.has(modelRef(r.provider.id, r.model.id)))
    }
    return searchModels(
      providers().filter((p) => p.id === rail()),
      "",
    ).filter(visible)
  })

  onMount(() => {
    const trigger = props.trigger()
    if (!trigger) return
    const form = trigger.closest(".composer-form")
    const r = (form ?? trigger).getBoundingClientRect()
    const anchor = form ? { top: r.top, bottom: r.bottom, left: r.left + 18, right: r.right } : r
    setPlace(
      placePanel(
        anchor,
        PANEL_W,
        PANEL_H,
        { width: window.innerWidth, height: window.innerHeight },
        form ? "above" : "below",
        form ? "start" : "end",
      ),
    )
  })
  let centered: string | undefined
  createEffect(
    on([rows, handle, query], ([list, vlist]) => {
      const typed = query().trim() !== ""
      const key = `${rail()}|${typed ? "q" : ""}`
      const fresh = key !== centered
      centered = key
      if (typed) {
        if (!fresh) return
        setAt(0)
        if (vlist) requestAnimationFrame(() => vlist.scrollToIndex(0, { align: "start" }))
        return
      }
      const here = list.findIndex((r) => modelRef(r.provider.id, r.model.id) === props.current)
      const target = Math.max(0, here)
      if (!fresh && target === at()) return
      setAt(target)
      if (here >= 0) requestAnimationFrame(() => vlist?.scrollToIndex(here, { align: "center" }))
    }),
  )
  const matching = createMemo(() => new Set(searchModels(providers(), query()).map((row) => row.provider.id)))
  const mixed = () => query().trim() !== "" || rail() === FAVORITES
  createEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panel?.contains(t) && !props.trigger()?.contains(t)) props.onOpenChange(false)
    }
    document.addEventListener("pointerdown", outside, true)
    onCleanup(() => document.removeEventListener("pointerdown", outside, true))
  })

  const move = (index: number) => {
    setAt(index)
    handle()?.scrollToIndex(index, { align: "nearest" })
  }
  const close = () => {
    props.onOpenChange(false)
    props.trigger()?.focus()
  }
  const pick = (row: ModelRow | undefined) => {
    if (!row) return
    props.onPick(modelRef(row.provider.id, row.model.id), row.model.thinking)
    close()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const last = rows().length - 1
    if (event.key === "ArrowDown") move(Math.min(last, at() + 1))
    else if (event.key === "ArrowUp") move(Math.max(0, at() - 1))
    else if (event.key === "Enter") pick(rows()[at()])
    else if (event.key === "Escape") close()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const railButton = (active: boolean) =>
    `picker-rail-button relative grid size-9 shrink-0 place-items-center rounded-row transition-[background-color,color,transform] duration-[var(--dur-hover)] ease-[var(--ease-kiko)] active:scale-95 ${active ? "bg-active text-fg" : "text-fg3 hover:bg-hover hover:text-fg"}`

  return (
    <Portal>
      <div
        ref={panel}
        class="picker-panel pointer-events-auto fixed z-[80] flex h-[380px] w-[420px] max-w-[calc(100vw-16px)] overflow-hidden rounded-sheet bg-raise shadow-[var(--float-shadow)]"
        style={place()}
        data-component="model-picker"
        data-kb-top-layer=""
      >
        <Show
          when={providers().length || catalog.loading}
          fallback={
            <p class="m-auto px-6 text-center text-[14px] text-fg3" data-component="model-empty">
              No provider is connected.{" "}
              <button
                type="button"
                class="text-fg underline"
                data-action="connect-provider"
                onClick={() => {
                  openSettings("models")
                  props.onOpenChange(false)
                }}
              >
                Connect one
              </button>{" "}
              to pick a model.
            </p>
          }
        >
          <nav
            class="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto bg-panel py-2 [scrollbar-width:none]"
            aria-label="Providers"
          >
            <button
              type="button"
              class={railButton(rail() === FAVORITES && !query())}
              title="Favorites"
              aria-label="Favorites"
              onClick={() => setRail(FAVORITES)}
            >
              <Star on={rail() === FAVORITES} />
            </button>
            <span class="my-0.5 h-px w-6 shrink-0 bg-line2" aria-hidden="true" />
            <For each={providers()}>
              {(provider) => (
                <button
                  type="button"
                  class={railButton(rail() === provider.id && !query())}
                  title={provider.name}
                  aria-label={provider.name}
                  data-provider={provider.id}
                  data-dim={query().trim() && !matching().has(provider.id) ? "" : undefined}
                  onClick={() => setRail(provider.id)}
                >
                  <ProviderIcon id={provider.id} width="16" height="16" />
                  <Show when={problemOf(provider.id)}>
                    <span
                      class="absolute right-1 top-1 size-1.5 rounded-full bg-bad"
                      role="img"
                      aria-label={PROBLEM_SHORT[problemOf(provider.id)!]}
                    />
                  </Show>
                </button>
              )}
            </For>
          </nav>
          <div class="flex min-w-0 flex-1 flex-col">
            <label class="flex h-13 shrink-0 items-center gap-3 px-4 text-fg2">
              <RemixIcon icon={SearchIcon} size={16} class="shrink-0" />
              <input
                ref={(el) => requestAnimationFrame(() => el.focus())}
                type="search"
                class="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg4"
                placeholder="Search models"
                aria-label="Search models"
                role="combobox"
                aria-expanded="true"
                aria-controls={id}
                aria-activedescendant={rows().length ? `${id}-${at()}` : undefined}
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={onKeyDown}
                data-component="model-search"
              />
              <kbd class="picker-kbd">Esc</kbd>
            </label>
            <Show
              when={rows().length}
              fallback={
                <p class="p-4 text-[14px] text-fg3">
                  {catalog.loading
                    ? "Loading models"
                    : query().trim()
                      ? "No models match"
                      : rail() === FAVORITES
                        ? "Star a model to keep it here."
                        : "No models"}
                </p>
              }
            >
              <VList
                ref={setHandle}
                id={id}
                role="listbox"
                aria-label="Models"
                class="min-h-0 flex-1 px-2 pb-2"
                data={rows()}
                itemSize={ROW_H}
              >
                {(row, i) => {
                  const ref = modelRef(row.provider.id, row.model.id)
                  const starred = () => favoriteModels().includes(ref)
                  return (
                    <div
                      id={`${id}-${i()}`}
                      role="option"
                      aria-selected={props.current === ref}
                      class="group/model flex h-11 cursor-pointer items-center gap-2 rounded-row px-2.5 transition-colors duration-[80ms] ease-[var(--ease-kiko)]"
                      classList={{ "bg-hover": at() === i(), "bg-active": props.current === ref }}
                      data-model={ref}
                      onPointerMove={() => setAt(i())}
                      onClick={() => pick(row)}
                    >
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-[14px] font-medium text-fg">{row.model.name}</span>
                        <span class="flex items-center gap-1 truncate text-[12.5px] text-fg3">
                          <Show when={mixed()}>
                            <ProviderIcon id={row.provider.id} width="11" height="11" />
                            {row.provider.name},
                          </Show>
                          {formatContext(row.model.contextWindow)} context, {formatPrice(row.model.pricing)}
                          <Show when={problemOf(row.provider.id)}>
                            {(problem) => (
                              <span class="text-bad" data-part="provider-problem">
                                {PROBLEM_SHORT[problem()]}
                              </span>
                            )}
                          </Show>
                        </span>
                      </span>
                      <Show when={props.current === ref}>
                        <RemixIcon icon={CheckIcon} size={15} class="shrink-0 text-fg" />
                      </Show>
                      <button
                        type="button"
                        class={`grid size-7 shrink-0 place-items-center rounded-row transition-[opacity,background-color,transform] duration-[var(--dur-hover)] hover:bg-active active:scale-90 ${starred() ? "text-warn" : "text-fg4 opacity-0 group-hover/model:opacity-100"}`}
                        aria-label={starred() ? `Unstar ${row.model.name}` : `Star ${row.model.name}`}
                        aria-pressed={starred()}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFavorite(ref)
                        }}
                      >
                        <Star on={starred()} />
                      </button>
                    </div>
                  )
                }}
              </VList>
            </Show>
            <div class="picker-footer">
              <span class="picker-hint">
                <span class="picker-kbd-pair">
                  <kbd class="picker-kbd">
                    <RemixIcon icon={ArrowUpIcon} size={12} />
                  </kbd>
                  <kbd class="picker-kbd picker-flip">
                    <RemixIcon icon={ArrowUpIcon} size={12} />
                  </kbd>
                </span>
                Move
              </span>
              <span class="picker-hint">
                <kbd class="picker-kbd">
                  <RemixIcon icon={EnterIcon} size={12} />
                </kbd>
                Choose
              </span>
            </div>
          </div>
        </Show>
      </div>
    </Portal>
  )
}
