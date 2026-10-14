import { A } from "@solidjs/router"
import { For, Show, createEffect, createMemo, createResource, createSignal, createUniqueId, on } from "solid-js"
import { Dialog } from "../lib/dialog"
import { chatModel, setChatModel } from "./chat-model"
import { formatContext, formatPrice, loadCatalog, modelRef, searchModels } from "./catalog"
import { connectedProviders } from "./connected"
import { hasModelProvider, modelProviders } from "./provider-kinds"
import { hiddenModels } from "./model-prefs"

const MAX_ROWS = 150

export function ModelList(props: { current?: string; onPick: (ref: string) => void; autofocus?: boolean }) {
  const [catalog] = createResource(loadCatalog)
  const [query, setQuery] = createSignal("")
  const connectedIds = createMemo(() => new Set(modelProviders(connectedProviders()).map((p) => p.provider)))
  const rows = createMemo(() => {
    const providers = catalog()?.providers.filter((p) => connectedIds().has(p.id)) ?? []
    const off = new Set(hiddenModels())
    return searchModels(providers, query()).filter((r) => {
      const ref = modelRef(r.provider.id, r.model.id)
      return !off.has(ref) || ref === props.current
    })
  })
  const shown = () => rows().slice(0, MAX_ROWS)
  const id = createUniqueId()
  const [at, setAt] = createSignal(0)
  let list: HTMLDivElement | undefined
  createEffect(on(query, () => setAt(0), { defer: true }))
  const move = (index: number) => {
    setAt(index)
    list?.querySelector(`#${CSS.escape(`${id}-${index}`)}`)?.scrollIntoView({ block: "nearest" })
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const last = shown().length - 1
    if (event.key === "ArrowDown") move(Math.min(last, at() + 1))
    else if (event.key === "ArrowUp") move(Math.max(0, at() - 1))
    else if (event.key === "Enter") {
      const row = shown()[at()]
      if (row) props.onPick(modelRef(row.provider.id, row.model.id))
    } else return
    event.preventDefault()
  }
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2" data-component="model-list">
      <Show when={connectedIds().size > 0}>
        <label class="flex h-9 shrink-0 items-center gap-2 rounded-full bg-[var(--secondary)] px-3.5 text-muted-foreground focus-within:bg-[var(--sidebar-row-hover)]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.75" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input
            type="search"
            class="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Search models"
            aria-label="Search models"
            role="combobox"
            aria-expanded="true"
            aria-controls={id}
            aria-activedescendant={shown().length ? `${id}-${at()}` : undefined}
            autofocus={props.autofocus}
            onKeyDown={onKeyDown}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            data-component="model-search"
          />
        </label>
      </Show>
      <Show
        when={connectedIds().size > 0}
        fallback={
          <div class="p-4 text-sm text-muted-foreground" data-component="model-empty">
            No provider is connected. <A href="/settings/providers" class="underline">Connect one</A> to pick a model.
          </div>
        }
      >
        <Show when={shown().length} fallback={<p class="p-4 text-sm text-muted-foreground">{catalog.loading ? "Loading models" : "No models match"}</p>}>
        <div ref={list} id={id} class="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Models" data-component="model-rows">
          <For each={shown()}>
            {({ provider, model }, i) => {
              const ref = modelRef(provider.id, model.id)
              return (
                <div
                  id={`${id}-${i()}`}
                  role="option"
                  aria-selected={props.current === ref}
                  class="model-row flex cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2 aria-selected:bg-[var(--tab-bg-active)] data-[active]:bg-[var(--tab-bg-hover)]"
                  style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 48px" }}
                  data-model={ref}
                  data-active={at() === i() ? "" : undefined}
                  onPointerMove={() => setAt(i())}
                  onClick={() => props.onPick(ref)}
                >
                  <span class="min-w-0">
                    <span class="block truncate text-sm text-[var(--tab-text-active)]">{model.name}</span>
                    <span class="block truncate text-xs text-muted-foreground">{provider.name}</span>
                  </span>
                  <span class="shrink-0 text-right text-xs text-muted-foreground">
                    <span class="block" data-field="context">{formatContext(model.contextWindow)} context</span>
                    <span class="block" data-field="price">{formatPrice(model.pricing)}</span>
                  </span>
                </div>
              )
            }}
          </For>
        </div>
        </Show>
      </Show>
    </div>
  )
}

const [pickerOpen, setPickerOpen] = createSignal(false)
export const openModelPicker = () => setPickerOpen(true)

export function ModelPickerButton(props: { chatId: string | null }) {
  const current = () => chatModel(props.chatId)
  const ready = () => hasModelProvider(connectedProviders())
  return (
    <>
      <Show when={ready()}>
        <button
          type="button"
          class="flex h-7 max-w-[200px] shrink-0 items-center gap-1 rounded-[9px] px-2 text-xs text-muted-foreground outline-none hover:bg-[var(--tab-bg-hover)] hover:text-foreground"
          data-component="model-picker-button"
          data-hint="chat.model"
          data-hint-label="Model"
          aria-label="Choose model"
          title="Choose model"
          onClick={() => setPickerOpen(true)}
        >
          <span class="truncate">{current()?.split("/").slice(1).join("/") ?? "Choose model"}</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 opacity-70" aria-hidden="true">
            <path d="M3 4.5L6 7.5l3-3" />
          </svg>
        </button>
      </Show>
      <Dialog open={pickerOpen()} onClose={() => setPickerOpen(false)} title="Choose a model" size="md" class="h-[min(560px,80dvh)]" bodyClass="flex flex-col px-3 pb-3" data-component="model-picker">
        <ModelList
          autofocus
          current={current()}
          onPick={(ref) => {
            setChatModel(props.chatId, ref)
            setPickerOpen(false)
          }}
        />
      </Dialog>
    </>
  )
}
