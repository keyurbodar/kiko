import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { cn } from "../lib/cn"
import { formatContext, modelRef, searchModels, type CatalogModel, type CatalogProvider } from "./catalog"
import { buttonClass } from "./kit"
import { groupForDisplay, modelPrefs, toggleFavorite } from "./model-prefs"

/*
 * The model picker, after t3code's (MIT, apps/web/src/components/chat/ProviderModelPicker.tsx,
 * ModelPickerContent.tsx, ModelPickerSidebar.tsx, ModelListRow.tsx). The trigger is the chosen
 * model with its provider's icon and a chevron. It opens a 360px panel: a rail of the connected
 * providers with favorites on top, and beside it a search over the models with each row's star.
 * A search looks through every connected provider. Models hidden in settings are left out, except
 * the chosen one.
 */

type Row = { provider: CatalogProvider; model: CatalogModel }
type Section = "favorites" | string

const PANEL_H = 346

const star = (filled: boolean) => (
  <svg class="size-3.5" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
  </svg>
)

export function StarButton(props: { on: boolean; name: string; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class={cn(
        "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-[color-mix(in_oklab,var(--text)_8%,transparent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        props.on ? "text-[#f5b83d]" : "text-[color-mix(in_oklab,var(--text)_40%,transparent)] hover:text-text",
      )}
      aria-pressed={props.on}
      aria-label={props.on ? `remove ${props.name} from favorites` : `add ${props.name} to favorites`}
      title={props.on ? "remove from favorites" : "add to favorites"}
      onClick={(e) => {
        e.stopPropagation()
        props.onToggle()
      }}
    >
      {star(props.on)}
    </button>
  )
}

export function ModelSelect(props: { providers: readonly CatalogProvider[]; value?: string; onPick: (ref: string) => void; label: string; "data-component"?: string }): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [section, setSection] = createSignal<Section>("favorites")
  const [place, setPlace] = createSignal<JSX.CSSProperties>({})
  let trigger: HTMLButtonElement | undefined

  const all = createMemo<Row[]>(() => props.providers.flatMap((provider) => provider.models.map((model) => ({ provider, model }))))
  const chosen = () => all().find((r) => modelRef(r.provider.id, r.model.id) === props.value)
  const refOf = (r: Row) => modelRef(r.provider.id, r.model.id)

  /** What the list shows: a search across providers, the favorites, or one provider's models. */
  const rows = createMemo<Row[]>(() => {
    const prefs = modelPrefs()
    const hidden = new Set(prefs.hidden)
    const visible = (r: Row) => !hidden.has(refOf(r)) || refOf(r) === props.value
    if (query().trim()) return searchModels(props.providers, query()).filter(visible)
    if (section() === "favorites") return groupForDisplay(all(), refOf, prefs).favorites
    const provider = props.providers.find((p) => p.id === section())
    return provider ? provider.models.map((model) => ({ provider, model })).filter(visible) : []
  })

  const show = () => {
    // Opens on the chosen model's provider, or on the favorites when there are some.
    const start = chosen()?.provider.id ?? (modelPrefs().favorites.length ? "favorites" : props.providers[0]?.id ?? "favorites")
    setSection(start)
    setQuery("")
    // In a portal, so no card clips it: fixed under the button's right edge, or above when the
    // window has no room below.
    const r = trigger!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8 >= PANEL_H
    setPlace({ right: `${Math.max(8, window.innerWidth - r.right)}px`, ...(below ? { top: `${r.bottom + 6}px` } : { bottom: `${window.innerHeight - r.top + 6}px` }) })
    setOpen(true)
  }
  const pick = (ref: string) => {
    props.onPick(ref)
    setOpen(false)
    trigger?.focus()
  }
  const crossProvider = () => !!query().trim() || section() === "favorites"

  const railButton = "relative grid aspect-square w-full cursor-pointer place-items-center rounded-md outline-none hover:bg-[color-mix(in_oklab,var(--text)_10%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--text)_10%,transparent)] aria-pressed:bg-[color-mix(in_oklab,var(--text)_12%,transparent)]"

  return (
    <div class="relative" data-component={props["data-component"]}>
      <button
        ref={trigger}
        type="button"
        class={buttonClass("secondary", "max-w-64 justify-between gap-2")}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-label={`${props.label}: ${chosen()?.model.name.toLowerCase() ?? "none"}`}
        onClick={() => (open() ? setOpen(false) : show())}
      >
        <span class="flex min-w-0 items-center gap-1.5">
          <Show when={chosen()}>{(r) => <ProviderIcon id={r().provider.id} width="14" height="14" />}</Show>
          <span class="truncate">{chosen()?.model.name.toLowerCase() ?? "choose a model"}</span>
        </span>
        <svg class="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <Show when={open()}>
        <Portal>
        <DismissableLayerV2
          active={open()}
          onDismiss={() => setOpen(false)}
          excludedElements={() => [trigger]}
          class={cn(
            "bg-menu fixed z-50 flex h-[346px] flex-row-reverse w-[360px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border shadow-popover",
            "border-[color-mix(in_oklab,var(--text)_10%,transparent)]",
          )}
          style={place()}
          // The search comes first in the markup, so the layer focuses it on open and Tab starts
          // there; the reversed row still draws the provider rail on the left.
          data-component="model-select"
        >
          <div class="flex min-w-0 flex-1 flex-col border-l border-[color-mix(in_oklab,var(--text)_8%,transparent)]">
            <input
              type="search"
              class="h-10 shrink-0 border-b border-[color-mix(in_oklab,var(--text)_8%,transparent)] bg-transparent px-3 text-[13px] text-text outline-none placeholder:text-[color-mix(in_oklab,var(--text)_40%,transparent)]"
              placeholder="search models"
              aria-label="search models"
              ref={(el) => requestAnimationFrame(() => el.focus())}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && rows()[0]) {
                  e.preventDefault()
                  pick(refOf(rows()[0]!))
                }
              }}
              data-component="model-search"
            />
            <div class="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label="models">
              <For
                each={rows()}
                fallback={
                  <p class="px-2.5 py-3 text-[12px] text-[color-mix(in_oklab,var(--text)_50%,transparent)]">
                    {query().trim() ? "no models match" : section() === "favorites" ? "no favorites yet. star a model to keep it here." : "no models"}
                  </p>
                }
              >
                {(r) => {
                  const ref = refOf(r)
                  const selected = () => ref === props.value
                  return (
                    <div
                      role="option"
                      aria-selected={selected()}
                      tabindex="0"
                      class="flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-1 pl-2.5 outline-none hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--text)_8%,transparent)] aria-selected:bg-[color-mix(in_oklab,var(--text)_8%,transparent)]"
                      style={{ "content-visibility": "auto", "contain-intrinsic-size": crossProvider() ? "auto 44px" : "auto 32px" }}
                      data-model={ref}
                      onClick={() => pick(ref)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          pick(ref)
                        }
                      }}
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[12px] font-medium leading-snug text-text">{r.model.name.toLowerCase()}</div>
                        <Show when={crossProvider()}>
                          <div class="mt-0.5 flex items-center gap-1.5 text-[12px] leading-snug text-[color-mix(in_oklab,var(--text)_50%,transparent)]">
                            <ProviderIcon id={r.provider.id} width="12" height="12" />
                            <span class="truncate">{r.provider.name.toLowerCase()}</span>
                          </div>
                        </Show>
                      </div>
                      <span class="shrink-0 text-[11px] tabular-nums text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{formatContext(r.model.contextWindow)}</span>
                      <Show when={selected()}>
                        <svg class="size-3.5 shrink-0 text-text" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M3.5 8.5l3 3 6-7" />
                        </svg>
                      </Show>
                      <StarButton on={modelPrefs().favorites.includes(ref)} name={r.model.name.toLowerCase()} onToggle={() => toggleFavorite(ref)} />
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
          <div class="w-11 shrink-0 overflow-y-auto bg-[color-mix(in_oklab,var(--text)_3%,transparent)] p-1 [scrollbar-width:none]" role="toolbar" aria-label="providers">
            <div class="flex flex-col gap-1">
              <button type="button" class={cn(railButton, "text-[#f5b83d]")} aria-pressed={!query().trim() && section() === "favorites"} aria-label="favorites" title="favorites" onClick={() => (setQuery(""), setSection("favorites"))}>
                {star(true)}
              </button>
              <div class="mx-1 border-b border-[color-mix(in_oklab,var(--text)_10%,transparent)]" />
              <For each={props.providers}>
                {(provider) => (
                  <button
                    type="button"
                    class={railButton}
                    aria-pressed={!query().trim() && section() === provider.id}
                    aria-label={provider.name.toLowerCase()}
                    title={provider.name.toLowerCase()}
                    onClick={() => (setQuery(""), setSection(provider.id))}
                  >
                    <ProviderIcon id={provider.id} width="18" height="18" />
                  </button>
                )}
              </For>
            </div>
          </div>
        </DismissableLayerV2>
        </Portal>
      </Show>
    </div>
  )
}
