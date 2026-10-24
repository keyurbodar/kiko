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
import { catalogQuery } from "./catalog"
import {
  ALL_PROVIDERS,
  modelDetail,
  modelRef,
  modelTrait,
  pickerEntries,
  type ModelRow,
  type PickerEntry,
} from "./model-list"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ArrowUpIcon, CheckIcon, EnterIcon, SearchIcon } from "@kiko/ui/icons"
import type { ThinkingLevel } from "@kiko/protocol"
import { connectedProviders } from "./connected"
import { favoriteModels, hiddenModels, toggleFavorite } from "./model-prefs"
import { modelProviders } from "./provider-kinds"
import { PROBLEM_SHORT } from "./provider-problem"
import { placePanel } from "../lib/place-panel"

const HEAD_H = 28
const PANEL_W = 420
const PANEL_H = 420

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

const problemOf = (id: string) => connectedProviders().find((p) => p.provider === id)?.problem

function Head(props: { entry: Extract<PickerEntry, { kind: "head" }> }) {
  return (
    <div
      class="flex items-center gap-1.5 px-2.5 pt-2 text-label text-fg3"
      style={{ height: `${HEAD_H}px` }}
      role="presentation"
      data-component="model-group"
    >
      <Show when={props.entry.provider}>
        {(provider) => <ProviderIcon id={provider().id} width="13" height="13" />}
      </Show>
      <span class="truncate">{props.entry.label}</span>
      <Show when={props.entry.provider && problemOf(props.entry.provider.id)}>
        {(problem) => (
          <span class="text-bad" data-part="provider-problem">
            {PROBLEM_SHORT[problem()]}
          </span>
        )}
      </Show>
    </div>
  )
}

function Row(props: {
  id: string
  entry: Extract<PickerEntry, { kind: "row" }>
  current: string | undefined
  active: boolean
  onHover: () => void
  onPick: () => void
}) {
  const row = () => props.entry.row
  const ref = () => props.entry.key
  const selected = () => props.current === ref()
  const starred = () => favoriteModels().includes(ref())
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={selected()}
      class="picker-row group/model flex h-11 cursor-pointer items-center gap-2 rounded-row px-2.5"
      classList={{ "bg-hover": props.active && !selected(), "bg-active": selected() }}
      title={selected() ? undefined : modelDetail(row().model)}
      data-model={ref()}
      onPointerMove={() => props.onHover()}
      onClick={() => props.onPick()}
    >
      <Show when={props.entry.mixed}>
        <ProviderIcon id={row().provider.id} width="13" height="13" />
      </Show>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="type-ui truncate text-fg">{row().model.name}</span>
        <Show when={selected()}>
          <span class="truncate text-hint text-fg3" data-part="model-detail">
            {modelDetail(row().model)}
          </span>
        </Show>
      </span>
      <Show
        when={problemOf(row().provider.id)}
        fallback={
          <Show when={!selected()}>
            <span class="type-hint shrink-0 text-fg4" data-part="model-trait">
              {modelTrait(row().model)}
            </span>
          </Show>
        }
      >
        {(problem) => (
          <span class="type-hint shrink-0 text-bad" data-part="provider-problem">
            {PROBLEM_SHORT[problem()]}
          </span>
        )}
      </Show>
      <Show when={selected()}>
        <RemixIcon icon={CheckIcon} size={15} class="shrink-0 text-fg" />
      </Show>
      <button
        type="button"
        class="picker-star grid size-7 shrink-0 place-items-center rounded-row"
        data-shown={starred() || selected() ? "" : undefined}
        aria-label={starred() ? `Unstar ${row().model.name}` : `Star ${row().model.name}`}
        aria-pressed={starred()}
        onClick={(e) => {
          e.stopPropagation()
          toggleFavorite(ref())
        }}
      >
        <Star on={starred()} />
      </button>
    </div>
  )
}

function ProviderFilter(props: {
  providers: readonly { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
}) {
  const options = () => [{ id: ALL_PROVIDERS, name: "All" }, ...props.providers]
  return (
    <div class="picker-filter" role="group" aria-label="Providers" data-component="model-provider-filter">
      <For each={options()}>
        {(option) => (
          <button
            type="button"
            class="picker-filter-chip"
            aria-pressed={props.value === option.id}
            data-provider={option.id === ALL_PROVIDERS ? undefined : option.id}
            onClick={() => props.onChange(option.id)}
          >
            <Show when={option.id !== ALL_PROVIDERS}>
              <ProviderIcon id={option.id} width="13" height="13" />
            </Show>
            {option.name}
          </button>
        )}
      </For>
    </div>
  )
}

export function ModelList(props: {
  current?: string
  onPick: (row: ModelRow) => void
  onClose: () => void
  autofocus: boolean
  footer: boolean
}) {
  const catalog = createQuery(catalogQuery)
  const providers = createMemo(() => {
    const ids = new Set(modelProviders(connectedProviders()).map((p) => p.provider))
    return catalog()?.providers.filter((p) => ids.has(p.id)) ?? []
  })
  const [filter, setFilter] = createSignal(ALL_PROVIDERS)
  const [query, setQuery] = createSignal("")
  const [at, setAt] = createSignal(0)
  const [handle, setHandle] = createSignal<VListHandle>()
  const id = createUniqueId()

  const entries = createMemo(() =>
    pickerEntries({
      providers: providers(),
      starred: favoriteModels(),
      hidden: hiddenModels(),
      current: props.current,
      filter: providers().some((p) => p.id === filter()) ? filter() : ALL_PROVIDERS,
      query: query(),
    }),
  )
  const rows = createMemo(() => entries().flatMap((e) => (e.kind === "row" ? [e] : [])))
  const entryIndex = (rowAt: number) => {
    const at = entries().findIndex((e) => e.kind === "row" && e.at === rowAt)
    return entries()[at - 1]?.kind === "head" ? at - 1 : at
  }

  let centered: string | undefined
  createEffect(
    on([rows, handle, query], ([list, vlist]) => {
      const typed = query().trim() !== ""
      const key = `${filter()}|${typed ? "q" : ""}`
      const fresh = key !== centered
      centered = key
      if (typed) {
        if (!fresh) return
        setAt(0)
        if (vlist) requestAnimationFrame(() => vlist.scrollToIndex(0, { align: "start" }))
        return
      }
      const here = list.findIndex((r) => r.key === props.current)
      const target = Math.max(0, here)
      if (!fresh && target === at()) return
      setAt(target)
      if (here >= 0) requestAnimationFrame(() => vlist?.scrollToIndex(entryIndex(here), { align: "center" }))
    }),
  )

  const move = (index: number) => {
    setAt(index)
    const entry = entryIndex(index)
    if (entry === 0) handle()?.scrollTo(0)
    else handle()?.scrollToIndex(entry, { align: "nearest" })
  }
  const pick = (entry: Extract<PickerEntry, { kind: "row" }> | undefined) => entry && props.onPick(entry.row)
  const onKeyDown = (event: KeyboardEvent) => {
    const last = rows().length - 1
    if (event.key === "ArrowDown") move(Math.min(last, at() + 1))
    else if (event.key === "ArrowUp") move(Math.max(0, at() - 1))
    else if (event.key === "Enter") pick(rows()[at()])
    else if (event.key === "Escape") props.onClose()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const empty = () => (catalog.loading ? "Loading models" : query().trim() ? "No models match" : "No models")

  return (
    <Show
      when={providers().length || catalog.loading}
      fallback={
        <p class="m-auto px-6 py-8 text-center text-ui text-fg3" data-component="model-empty">
          No provider is connected.{" "}
          <button
            type="button"
            class="text-fg underline"
            data-action="connect-provider"
            onClick={() => {
              openSettings("models")
              props.onClose()
            }}
          >
            Connect one
          </button>{" "}
          to pick a model.
        </p>
      }
    >
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <label class="flex h-12 shrink-0 items-center gap-3 px-4 text-fg2">
          <RemixIcon icon={SearchIcon} size={16} class="shrink-0" />
          <input
            ref={(el) => props.autofocus && requestAnimationFrame(() => el.focus())}
            type="search"
            class="h-full min-w-0 flex-1 bg-transparent text-msg text-fg outline-none placeholder:text-fg4"
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
          <Show when={props.footer}>
            <kbd class="picker-kbd">Esc</kbd>
          </Show>
        </label>
        <Show when={providers().length > 1 && !query().trim()}>
          <ProviderFilter providers={providers()} value={filter()} onChange={setFilter} />
        </Show>
        <Show when={rows().length} fallback={<p class="p-4 text-ui text-fg3">{empty()}</p>}>
          <VList
            ref={setHandle}
            id={id}
            role="listbox"
            aria-label="Models"
            class="min-h-0 flex-1 px-2 pb-2"
            data={entries()}
          >
            {(entry) =>
              entry.kind === "head" ? (
                <Head entry={entry} />
              ) : (
                <Row
                  id={`${id}-${entry.at}`}
                  entry={entry}
                  current={props.current}
                  active={at() === entry.at}
                  onHover={() => setAt(entry.at)}
                  onPick={() => pick(entry)}
                />
              )
            }
          </VList>
        </Show>
        <Show when={props.footer}>
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
        </Show>
      </div>
    </Show>
  )
}

export default function ModelPickerPanel(props: {
  current?: string
  onPick: (ref: string, thinking: readonly ThinkingLevel[]) => void
  onOpenChange: (open: boolean) => void
  trigger: () => HTMLButtonElement | undefined
}) {
  const [place, setPlace] = createSignal<JSX.CSSProperties>({})
  let panel: HTMLDivElement | undefined

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
  createEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panel?.contains(t) && !props.trigger()?.contains(t)) props.onOpenChange(false)
    }
    document.addEventListener("pointerdown", outside, true)
    onCleanup(() => document.removeEventListener("pointerdown", outside, true))
  })
  const close = () => {
    props.onOpenChange(false)
    props.trigger()?.focus()
  }

  return (
    <Portal>
      <div
        ref={panel}
        class="picker-panel pointer-events-auto fixed z-[80] flex h-[420px] w-[420px] max-w-[calc(100vw-16px)] overflow-hidden rounded-sheet bg-raise shadow-[var(--float-shadow)]"
        style={place()}
        data-component="model-picker"
        data-kb-top-layer=""
      >
        <ModelList
          current={props.current}
          autofocus
          footer
          onClose={close}
          onPick={(row) => {
            props.onPick(modelRef(row.provider.id, row.model.id), row.model.thinking)
            close()
          }}
        />
      </div>
    </Portal>
  )
}
