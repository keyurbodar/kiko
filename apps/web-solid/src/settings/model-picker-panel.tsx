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
  STARRED,
  modelDetail,
  modelRef,
  pickerEntries,
  providerOf,
  type ModelRow,
  type PickerEntry,
} from "./model-list"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, ChevronRightIcon, SearchIcon } from "@kiko/ui/icons"
import type { ThinkingLevel } from "@kiko/protocol"
import { connectedProviders } from "./connected"
import { favoriteModels, hiddenModels, toggleFavorite } from "./model-prefs"
import { modelProviders } from "./provider-kinds"
import { PROBLEM_SHORT } from "./provider-problem"
import { placePanel } from "../lib/place-panel"

const PANEL_W = 400
const PANEL_H = 392

function Star(props: { on: boolean }) {
  return (
    <svg
      class="size-4"
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
      class="picker-row group/model flex h-9 cursor-pointer items-center gap-2 rounded-row px-2.5"
      classList={{ "bg-hover": props.active }}
      title={modelDetail(row().model)}
      data-model={ref()}
      onPointerMove={() => props.onHover()}
      onClick={() => props.onPick()}
    >
      <Show when={props.entry.mixed}>
        <ProviderIcon id={row().provider.id} width="13" height="13" />
      </Show>
      <span class="type-ui min-w-0 flex-1 truncate text-fg">{row().model.name}</span>
      <Show when={problemOf(row().provider.id)}>
        {(problem) => (
          <span class="type-hint shrink-0 text-bad" data-part="provider-problem">
            {PROBLEM_SHORT[problem()]}
          </span>
        )}
      </Show>
      <button
        type="button"
        class="picker-star grid size-6 shrink-0 place-items-center rounded-row"
        data-shown={starred() ? "" : undefined}
        aria-label={starred() ? `Unstar ${row().model.name}` : `Star ${row().model.name}`}
        aria-pressed={starred()}
        onClick={(e) => {
          e.stopPropagation()
          toggleFavorite(ref())
        }}
      >
        <Star on={starred()} />
      </button>
      <span class="grid size-4 shrink-0 place-items-center text-fg" aria-hidden="true">
        <Show when={selected()}>
          <RemixIcon icon={CheckIcon} size={16} class="picker-check" />
        </Show>
      </span>
    </div>
  )
}

function LegacyRow(props: { entry: Extract<PickerEntry, { kind: "legacy" }>; onToggle: () => void }) {
  return (
    <button
      type="button"
      class="picker-row picker-legacy flex h-12 w-full cursor-pointer items-center gap-2 rounded-row px-2.5 text-left"
      aria-expanded={props.entry.open}
      data-component="model-legacy"
      onClick={() => props.onToggle()}
    >
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="type-ui text-fg">Legacy models</span>
        <span class="text-hint text-fg3">{props.entry.count} models</span>
      </span>
      <RemixIcon icon={ChevronRightIcon} size={16} class="picker-legacy-chevron shrink-0 text-fg2" />
    </button>
  )
}

function ProviderRail(props: {
  providers: readonly { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <nav class="picker-rail" aria-label="Providers" data-component="model-provider-filter">
      <button
        type="button"
        class="picker-rail-item"
        aria-pressed={props.value === STARRED}
        aria-label="Starred"
        title="Starred"
        data-provider="starred"
        onClick={() => props.onChange(STARRED)}
      >
        <Star on />
      </button>
      <span class="picker-rail-rule" aria-hidden="true" />
      <For each={props.providers}>
        {(provider) => (
          <button
            type="button"
            class="picker-rail-item"
            aria-pressed={props.value === provider.id}
            aria-label={provider.name}
            title={provider.name}
            data-provider={provider.id}
            onClick={() => props.onChange(provider.id)}
          >
            <ProviderIcon id={provider.id} width="16" height="16" />
            <Show when={problemOf(provider.id)}>
              {(problem) => <span class="picker-rail-dot" role="img" aria-label={PROBLEM_SHORT[problem()]} />}
            </Show>
          </button>
        )}
      </For>
    </nav>
  )
}

export function ModelList(props: {
  current?: string
  onPick: (row: ModelRow) => void
  onClose: () => void
  autofocus: boolean
}) {
  const catalog = createQuery(catalogQuery)
  const providers = createMemo(() => {
    const ids = new Set(modelProviders(connectedProviders()).map((p) => p.provider))
    return catalog()?.providers.filter((p) => ids.has(p.id)) ?? []
  })
  const [chosen, setChosen] = createSignal<string>()
  const [legacyOpen, setLegacyOpen] = createSignal(false)
  const filter = createMemo(() => {
    const known = (value: string | undefined) => value === STARRED || providers().some((p) => p.id === value)
    const own = providerOf(props.current)
    const first = providers()[0]?.id
    return [chosen(), own, first].find(known) ?? STARRED
  })
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
      filter: filter(),
      query: query(),
      legacyOpen: legacyOpen(),
    }),
  )
  const rows = createMemo(() => entries().flatMap((e) => (e.kind === "row" ? [e] : [])))
  createEffect(() => setAt((n) => Math.min(n, Math.max(0, rows().length - 1))))
  const entryIndex = (rowAt: number) => entries().findIndex((e) => e.kind === "row" && e.at === rowAt)

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

  const empty = () =>
    catalog.loading
      ? "Loading models"
      : query().trim()
        ? "No models match"
        : filter() === STARRED
          ? "Star a model to keep it here."
          : "No models"
  const chooseFilter = (id: string) => {
    setQuery("")
    setLegacyOpen(false)
    setChosen(id)
  }

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
      <ProviderRail providers={providers()} value={query().trim() ? "" : filter()} onChange={chooseFilter} />
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <label class="picker-search relative mx-3 mt-2.5 flex shrink-0 items-center border-b border-line2 pb-1.5 text-fg3">
          <RemixIcon icon={SearchIcon} size={16} class="pointer-events-none absolute left-0 top-1.5 shrink-0" />
          <input
            ref={(el) => props.autofocus && requestAnimationFrame(() => el.focus())}
            type="search"
            class="h-6 min-w-0 flex-1 bg-transparent pl-5 text-ui text-fg outline-none placeholder:text-fg4"
            placeholder="Search models..."
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
        </label>
        <Show when={rows().length} fallback={<p class="p-4 text-ui text-fg3">{empty()}</p>}>
          <VList
            ref={setHandle}
            id={id}
            role="listbox"
            aria-label="Models"
            class="min-h-0 flex-1 px-1 py-1"
            data={entries()}
          >
            {(entry) =>
              entry.kind === "legacy" ? (
                <LegacyRow entry={entry} onToggle={() => setLegacyOpen((open) => !open)} />
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
      </div>
    </Show>
  )
}

export default function ModelPickerPanel(props: {
  current?: string
  onPick: (ref: string, thinking: readonly ThinkingLevel[], name: string) => void
  onOpenChange: (open: boolean) => void
  trigger: () => HTMLButtonElement | undefined
}) {
  const [place, setPlace] = createSignal<JSX.CSSProperties>({})
  let panel: HTMLDivElement | undefined

  onMount(() => {
    const trigger = props.trigger()
    if (!trigger) return
    const form = trigger.closest(".composer-form")
    const measure = () => {
      const button = trigger.getBoundingClientRect()
      const edge = form?.getBoundingClientRect() ?? button
      const anchor = { top: edge.top, bottom: edge.bottom, left: button.left, right: button.right }
      setPlace(
        placePanel(
          anchor,
          PANEL_W,
          PANEL_H,
          { width: window.innerWidth, height: window.innerHeight },
          form ? "above" : "below",
          "end",
        ),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(form ?? trigger)
    window.addEventListener("resize", measure)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    })
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
        class="picker-panel pointer-events-auto fixed z-[80] flex h-[392px] w-[400px] max-w-[calc(100vw-16px)] overflow-hidden rounded-sheet bg-raise shadow-[var(--float-shadow)]"
        style={place()}
        data-component="model-picker"
        data-kb-top-layer=""
      >
        <ModelList
          current={props.current}
          autofocus
          onClose={close}
          onPick={(row) => {
            props.onPick(modelRef(row.provider.id, row.model.id), row.model.thinking, row.model.name)
            close()
          }}
        />
      </div>
    </Portal>
  )
}
