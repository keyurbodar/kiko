import { A } from "@solidjs/router"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { chatModel, setChatModel } from "./chat-model"
import { formatContext, formatPrice, loadCatalog, modelRef, searchModels } from "./catalog"
import { connectedProviders } from "./connected"

// At most this many rows render for one search. A catalog holds hundreds of
// models, and a search narrows it faster than scrolling does.
const MAX_ROWS = 150

/*
 * The model list with search, context size and price. It lists the models of
 * connected providers only, because a model of an unconnected provider cannot
 * run. With none connected it says so and links to settings.
 */
export function ModelList(props: { current?: string; onPick: (ref: string) => void; autofocus?: boolean }) {
  const [catalog] = createResource(loadCatalog)
  const [query, setQuery] = createSignal("")
  const connectedIds = createMemo(() => new Set(connectedProviders().map((p) => p.provider)))
  const rows = createMemo(() => {
    const providers = catalog()?.providers.filter((p) => connectedIds().has(p.id)) ?? []
    return searchModels(providers, query())
  })
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2" data-component="model-list">
      <input
        type="search"
        class="h-9 shrink-0 rounded-[10px] bg-[var(--input-bg)] px-3 text-sm text-[var(--tab-text-active)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        placeholder="search models"
        aria-label="search models"
        autofocus={props.autofocus}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        data-component="model-search"
      />
      <Show
        when={connectedIds().size > 0}
        fallback={
          <div class="p-4 text-sm text-weak" data-component="model-empty">
            no provider is connected. <A href="/settings/providers" class="underline">connect one</A> to pick a model.
          </div>
        }
      >
        <ul class="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="models" data-component="model-rows">
          <For each={rows().slice(0, MAX_ROWS)} fallback={<li class="p-4 text-sm text-weak">{catalog.loading ? "loading models" : "no models match"}</li>}>
            {({ provider, model }) => {
              const ref = modelRef(provider.id, model.id)
              return (
                <li
                  role="option"
                  aria-selected={props.current === ref}
                  tabindex="0"
                  class="model-row flex cursor-default items-center justify-between gap-3 rounded-[10px] px-3 py-2 outline-none hover:bg-[var(--tab-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-selected:bg-[var(--tab-bg-active)]"
                  style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 48px" }}
                  data-model={ref}
                  onClick={() => props.onPick(ref)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      props.onPick(ref)
                    }
                  }}
                >
                  <span class="min-w-0">
                    <span class="block truncate text-sm text-[var(--tab-text-active)]">{model.name.toLowerCase()}</span>
                    <span class="block truncate text-xs text-weak">{provider.name.toLowerCase()}</span>
                  </span>
                  <span class="shrink-0 text-right text-xs text-weak">
                    <span class="block" data-field="context">{formatContext(model.contextWindow)} context</span>
                    <span class="block" data-field="price">{formatPrice(model.pricing)}</span>
                  </span>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
    </div>
  )
}

/** Whether the picker is open. A command opens it, so `chat: choose model` works from the keyboard. */
const [pickerOpen, setPickerOpen] = createSignal(false)
export const openModelPicker = () => setPickerOpen(true)

/** The chat top bar control: shows the chat's model and opens the picker. Picking applies at once. */
export function ModelPickerButton(props: { chatId: string | null }) {
  const open = pickerOpen
  const setOpen = setPickerOpen
  const current = () => chatModel(props.chatId)
  return (
    <ModalV2 open={open()} onOpenChange={setOpen}>
      <button
        type="button"
        class="ml-auto h-7 max-w-[220px] shrink-0 truncate rounded-[10px] px-2 text-xs text-muted hover:bg-[var(--tab-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        data-component="model-picker-button"
        aria-label="choose model"
        onClick={() => setOpen(true)}
      >
        {current()?.split("/").slice(1).join("/") ?? "choose model"}
      </button>
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content class="h-[min(560px,80dvh)] w-[min(520px,94vw)] flex-col gap-2 rounded-[16px] bg-bg p-3 shadow-xl">
          <ModalV2.Title class="px-1 text-sm font-medium text-muted">choose a model</ModalV2.Title>
          <ModelList
            autofocus
            current={current()}
            onPick={(ref) => {
              setChatModel(props.chatId, ref)
              setOpen(false)
            }}
          />
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
