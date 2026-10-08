import { For, Show, Suspense, createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { formatContext, loadCatalog, modelRef, type CatalogModel, type CatalogProvider, type ConnectMethod } from "./catalog"
import { chatModel, setChatModel } from "./chat-model"
import { connectedProviders, connectedReady, refreshConnected } from "./connected"
import { Moment } from "../mascot/pixel/lazy"
import { connectProvider, disconnectProvider } from "./credentials"
import { startSignIn, type SignIn, type SignInHandle } from "./provider-login"
import { Button, DetailsButton, fieldClass, line, Notice, Pill, Radio, Toggle } from "./kit"
import { groupForDisplay, modelPrefs, setHidden, toggleFavorite } from "./model-prefs"
import { cn } from "../lib/cn"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "api key",
  device_code: "device code sign-in",
  paste_code: "browser sign-in",
}


/*
 * Settings, models. One card per connected provider: its header says how it is connected and
 * holds its two actions, and its rows are its models. Each fact is shown once. The default for new
 * chats is the radio on a model's row, one across every provider, so there is no separate
 * default setting. A provider is added from a dialog with a search over every provider, which
 * leads straight into its connect step. After t3code's providers settings (MIT,
 * ProviderSettingsPanel.tsx, ProviderModelsSection.tsx, AddProviderInstanceDialog.tsx).
 */
export function ModelsPage() {
  const [catalog] = createResource(loadCatalog)
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const [adding, setAdding] = createSignal(false)
  const saved = (id: string) => connectedProviders().find((p) => p.provider === id)
  const connected = createMemo(() => (catalog()?.providers ?? []).filter((p) => saved(p.id)))
  const available = createMemo(() => (catalog()?.providers ?? []).filter((p) => !saved(p.id)))

  // The first provider is the moment kiko starts working, so the birds cheer once. Only a
  // change seen on this page counts: a list that loads with providers in it is not a moment.
  const [cheer, setCheer] = createSignal(false)
  createEffect(
    on(
      () => (connectedReady() ? connectedProviders().length : -1),
      (count, prev) => {
        if (prev !== 0 || count < 1) return
        setCheer(true)
        const timer = setTimeout(() => setCheer(false), 2400)
        onCleanup(() => clearTimeout(timer))
      },
    ),
  )

  return (
    <div class="flex flex-col gap-4" data-component="models-page">
      <Show when={cheer()}>
        <div class="flex items-center gap-3 rounded-xl bg-[var(--accent-wash)] px-4 py-2.5" data-component="first-provider-cheer" role="status">
          <Suspense>
            <Moment kind="cheer" faces={["kiko", "scout", "budget"]} />
          </Suspense>
          <p class="text-[13px] text-text">connected. your agents can reply now.</p>
        </div>
      </Show>
      <Show when={catalog.error}>
        <Notice data-component="catalog-error">the model catalog did not load. reload to try again.</Notice>
      </Show>
      <Show
        when={connected().length}
        fallback={
          <div class={cn(card, "flex flex-col items-center gap-3 px-6 py-14 text-center")} data-component="no-provider">
            <p class="text-[14px] font-medium text-text">{catalog.loading ? "loading providers" : "no provider yet"}</p>
            <p class="-mt-2 max-w-sm text-[13px] text-[color-mix(in_oklab,var(--text)_50%,transparent)]">connect one to start chatting.</p>
            <Button variant="primary" data-action="add-provider" onClick={() => setAdding(true)}>
              add provider
            </Button>
          </div>
        }
      >
        <div class="flex justify-end">
          <Button data-action="add-provider" onClick={() => setAdding(true)}>
            <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
            add provider
          </Button>
        </div>
        <For each={connected()}>{(provider) => <ProviderCard provider={provider} info={saved(provider.id)!} onReconnect={() => setDialog(provider)} />}</For>
      </Show>
      <AddProviderDialog
        open={adding()}
        loading={catalog.loading}
        providers={available()}
        onClose={() => setAdding(false)}
        onPick={(provider) => {
          setAdding(false)
          setDialog(provider)
        }}
      />
      <ConnectDialog provider={dialog()} onClose={() => setDialog(null)} />
    </div>
  )
}

const card = "overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--text)_10%,transparent)] bg-[color-mix(in_oklab,var(--text)_3%,transparent)]"
const faint = "text-[color-mix(in_oklab,var(--text)_45%,transparent)]"

/** Above this many models a provider's list gets a filter, as in t3code. */
const FILTER_THRESHOLD = 8
/** A long list shows this many until "show all". */
const PREVIEW_MODELS = 10

const starIcon = (filled: boolean) => (
  <svg class="size-3.5" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
  </svg>
)

/**
 * A connected provider: one header line (who, how it is connected, its two actions) over its
 * models. A row's radio makes it the default for new chats, its star puts it first in the model
 * picker, and its switch says whether the picker offers it.
 */
function ProviderCard(props: { provider: CatalogProvider; info: { kind: string; last4: string }; onReconnect: () => void }) {
  const [removing, setRemoving] = createSignal(false)
  const [filter, setFilter] = createSignal("")
  const [all, setAll] = createSignal(false)
  async function remove() {
    setRemoving(true)
    try {
      await disconnectProvider(props.provider.id)
    } finally {
      setRemoving(false)
      await refreshConnected()
    }
  }
  const byKey = () => props.info.kind === "api_key"
  const refOf = (m: CatalogModel) => modelRef(props.provider.id, m.id)
  const hidden = () => new Set(modelPrefs().hidden)
  const matching = createMemo(() => {
    const words = filter().toLowerCase().split(/\s+/).filter(Boolean)
    return props.provider.models.filter((m) => words.every((w) => `${m.name} ${m.id}`.toLowerCase().includes(w)))
  })
  // Favorites first, then the shown models, then the hidden ones.
  const ordered = createMemo(() => {
    const g = groupForDisplay(matching(), refOf, modelPrefs())
    return [...g.favorites, ...g.shown, ...g.hidden]
  })
  const long = () => !filter().trim() && ordered().length > PREVIEW_MODELS
  const rows = () => (long() && !all() ? ordered().slice(0, PREVIEW_MODELS) : ordered())

  const row = (m: CatalogModel) => {
    const ref = refOf(m)
    const isDefault = () => chatModel(null) === ref
    const off = () => hidden().has(ref)
    const favorite = () => modelPrefs().favorites.includes(ref)
    return (
      <div
        class="grid h-9 grid-cols-[1rem_minmax(0,1fr)_auto_1.5rem_auto] items-center gap-3 px-4 hover:bg-[color-mix(in_oklab,var(--text)_3%,transparent)]"
        data-model={ref}
      >
        <button
          type="button"
          role="radio"
          aria-checked={isDefault()}
          aria-label={`start new chats on ${m.name.toLowerCase()}`}
          title="start new chats on this model"
          class="grid cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => setChatModel(null, ref)}
        >
          <Radio on={isDefault()} />
        </button>
        <span class="flex min-w-0 items-baseline gap-2" classList={{ "opacity-50": off() && !isDefault() }}>
          <span class="truncate text-[13px] text-text">{m.name.toLowerCase()}</span>
          <Show when={isDefault()}>
            <Pill tone="accent" data-component="default-model">default</Pill>
          </Show>
          <Show when={m.name.toLowerCase() !== m.id.toLowerCase()}>
            <code class={cn("hidden truncate font-mono text-[11px] sm:inline", faint)}>{m.id}</code>
          </Show>
        </span>
        <span class={cn("text-[12px] tabular-nums", faint)}>
          {formatContext(m.contextWindow)}
          {m.reasoning ? " · reasoning" : ""}
        </span>
        <button
          type="button"
          class={cn(
            "grid size-6 cursor-pointer place-items-center rounded-md outline-none hover:bg-[color-mix(in_oklab,var(--text)_8%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            favorite() ? "text-[#f5b83d]" : "text-[color-mix(in_oklab,var(--text)_35%,transparent)] hover:text-text",
          )}
          aria-pressed={favorite()}
          aria-label={favorite() ? `remove ${m.name.toLowerCase()} from favorites` : `add ${m.name.toLowerCase()} to favorites`}
          title={favorite() ? "remove from favorites" : "favorite: first in the model picker"}
          onClick={() => toggleFavorite(ref)}
        >
          {starIcon(favorite())}
        </button>
        <Toggle label={`show ${m.name.toLowerCase()} in the model picker`} on={!off()} onChange={(on) => setHidden([ref], !on)} />
      </div>
    )
  }

  return (
    <section class={card} data-provider={props.provider.id} data-connected="true" data-provider-models={props.provider.id}>
      <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[color-mix(in_oklab,var(--text)_6%,transparent)] px-4 py-3">
        <ProviderIcon id={props.provider.id} width="18" height="18" />
        <h2 class="min-w-0 truncate text-[14px] font-semibold text-text">{props.provider.name.toLowerCase()}</h2>
        <span class={cn("text-[12px]", faint)}>{byKey() ? `key ••${props.info.last4}` : "signed in"}</span>
        <span class="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" data-action="reconnect" onClick={() => props.onReconnect()}>
            {byKey() ? "replace key" : "sign in again"}
          </Button>
          <Button variant="danger" data-action="disconnect" disabled={removing()} onClick={() => void remove()}>
            disconnect
          </Button>
        </span>
      </header>
      <Show when={props.provider.models.length > FILTER_THRESHOLD}>
        <div class="px-4 pt-3 pb-1">
          <input class={cn(fieldClass, "w-56 max-w-full")} placeholder="filter models" aria-label={`filter ${props.provider.name.toLowerCase()} models`} spellcheck={false} value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
        </div>
      </Show>
      <div class="py-1.5" role="radiogroup" aria-label={`${props.provider.name.toLowerCase()} models`}>
        <For each={rows()} fallback={<p class={cn("px-4 py-2 text-[12px]", faint)}>no models match</p>}>{row}</For>
      </div>
      <Show when={long()}>
        <div class="border-t border-[color-mix(in_oklab,var(--text)_6%,transparent)] px-2 py-1.5">
          <DetailsButton open={all()} onToggle={() => setAll(!all())} label={all() ? "show fewer" : `show all ${ordered().length}`} data-action="show-all-models" />
        </div>
      </Show>
    </section>
  )
}

/**
 * Adding a provider, after t3code's add-provider dialog: a search over every provider not yet
 * connected and a grid of them. Choosing one goes straight to its connect step.
 */
function AddProviderDialog(props: { open: boolean; loading: boolean; providers: readonly CatalogProvider[]; onClose: () => void; onPick: (provider: CatalogProvider) => void }) {
  const [query, setQuery] = createSignal("")
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase()
    return q ? props.providers.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : props.providers
  })
  return (
    <ModalV2
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setQuery("")
          props.onClose()
        }
      }}
    >
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content class="flex h-[min(560px,86dvh)] w-[min(600px,94vw)] flex-col overflow-hidden rounded-2xl bg-menu shadow-xl" data-component="provider-add">
          <div class="flex flex-col gap-3 border-b border-[color-mix(in_oklab,var(--text)_8%,transparent)] p-4">
            <div>
              <ModalV2.Title class="text-[15px] font-semibold text-text">add a provider</ModalV2.Title>
              <p class="mt-1 text-[12px] text-[color-mix(in_oklab,var(--text)_50%,transparent)]">pick the service whose models your agents should use. its key stays on the server.</p>
            </div>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                const first = shown()[0]
                if (first) props.onPick(first)
              }}
            >
              <input
                type="search"
                class={cn(fieldClass, "h-8 w-full")}
                placeholder="search providers"
                aria-label="search providers"
                autocomplete="off"
                value={query()}
                ref={(el) => requestAnimationFrame(() => el.focus())}
                onInput={(e) => setQuery(e.currentTarget.value)}
                data-component="provider-search"
              />
            </form>
          </div>
          <ul class="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto p-4 sm:grid-cols-2" data-component="provider-list">
            <For each={shown()} fallback={<li class="text-[13px] text-[color-mix(in_oklab,var(--text)_50%,transparent)] sm:col-span-2">{props.loading ? "loading providers" : "no provider matches"}</li>}>
              {(provider) => (
                <li data-provider={provider.id}>
                  <button
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-[color-mix(in_oklab,var(--text)_3%,transparent)] px-3 py-3 text-left outline-none ring-1 ring-[color-mix(in_oklab,var(--text)_6%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    data-action="connect"
                    onClick={() => props.onPick(provider)}
                  >
                    <ProviderIcon id={provider.id} width="18" height="18" />
                    <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{provider.name.toLowerCase()}</span>
                    <span class="shrink-0 text-[12px] tabular-nums text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{provider.models.length}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}

/*
 * The key lives in this component's form field and in the one PUT body. The
 * field is cleared before the request leaves, so a failure shows the error and
 * asks for the key again instead of holding on to it.
 */
function ConnectDialog(props: { provider: CatalogProvider | null; onClose: () => void }) {
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  let input: HTMLInputElement | undefined

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const provider = props.provider
    if (!provider || !input) return
    const key = input.value.trim()
    input.value = ""
    if (!key) return
    setBusy(true)
    setError(null)
    try {
      await connectProvider(provider.id, key)
      await refreshConnected()
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message.toLowerCase() : "could not save the key")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalV2
      open={props.provider !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          props.onClose()
        }
      }}
    >
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content class="w-[min(420px,94vw)] flex-col gap-4 rounded-[16px] bg-menu p-4 shadow-xl">
          <ModalV2.Title class="text-[13px] font-semibold text-text" data-component="connect-title">
            connect {props.provider?.name.toLowerCase()}
          </ModalV2.Title>
          <For each={props.provider?.connect ?? []}>
            {(method) =>
              method === "api_key" ? (
                <form class="flex flex-col gap-2.5" onSubmit={submit} data-method="api_key">
                  <label class="text-xs text-muted" for="provider-key">api key</label>
                  <input
                    id="provider-key"
                    ref={input}
                    type="password"
                    name="kiko-provider-secret"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck={false}
                    autofocus
                    class={cn(fieldClass, "w-full")}
                    data-component="provider-key"
                  />
                  <Show when={error()}>
                    <Notice data-component="connect-error">{error()!}</Notice>
                  </Show>
                  <div class="flex justify-end gap-2">
                    <Button variant="ghost" data-action="cancel-connect" onClick={() => { setError(null); props.onClose() }}>
                      cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={busy()} data-action="save-key">
                      save key
                    </Button>
                  </div>
                </form>
              ) : (
                <SignInMethod
                  provider={props.provider!.id}
                  method={method}
                  onDone={async () => {
                    await refreshConnected()
                    props.onClose()
                  }}
                />
              )
            }
          </For>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}

/*
 * One sign-in method in the connect dialog. The server runs the flow and this
 * shows what it sends: a device code or a sign-in link, a progress line, and a
 * question to answer. Closing the dialog ends the sign-in.
 */
function SignInMethod(props: { provider: string; method: ConnectMethod; onDone: () => void }) {
  const [state, setState] = createSignal<SignIn | null>(null)
  let handle: SignInHandle | undefined
  let input: HTMLInputElement | undefined
  onCleanup(() => handle?.cancel())

  function start() {
    handle?.cancel()
    handle = startSignIn(props.provider, (next) => {
      setState(next)
      if (next.status === "done") props.onDone()
    })
  }

  function answer(event: SubmitEvent) {
    event.preventDefault()
    const prompt = state()?.prompt
    if (!prompt || !input) return
    const value = input.value
    input.value = ""
    handle?.answer(prompt.promptId, value)
  }

  const running = () => state()?.status === "running"

  return (
    <div class="flex flex-col gap-2" data-method={props.method} data-sign-in={state()?.status ?? "idle"}>
      <div class="flex items-center justify-between gap-2">
        <span class="text-[13px] text-text">{METHOD_LABEL[props.method]}</span>
        <Show
          when={running()}
          fallback={
            <Button variant="primary" data-action="sign-in" onClick={start}>
              {state()?.status === "error" ? "try again" : "sign in"}
            </Button>
          }
        >
          <Button
            variant="ghost"
            data-action="cancel-sign-in"
            onClick={() => {
              handle?.cancel()
              setState(null)
            }}
          >
            cancel
          </Button>
        </Show>
      </div>
      <Show when={running() ? state() : null}>
        {(s) => (
          <>
            <Show when={s().code}>
              {(code) => (
                <div class={cn("flex flex-col gap-1 rounded-xl border p-3", line, "bg-[color-mix(in_oklab,var(--text)_3%,transparent)]")} data-component="device-code">
                  <span class="text-xs text-muted">enter this code at the provider</span>
                  <span class="select-all font-mono text-lg tracking-widest text-text">{code().userCode}</span>
                  <a
                    href={code().verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-xs text-[var(--accent)]"
                  >
                    open {code().verificationUri.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
            </Show>
            <Show when={s().link}>
              {(link) => (
                <div class={cn("flex flex-col gap-1 rounded-xl border p-3", line, "bg-[color-mix(in_oklab,var(--text)_3%,transparent)]")} data-component="sign-in-link">
                  <Show when={link().instructions}>
                    <span class="text-xs text-muted">{link().instructions!.toLowerCase()}</span>
                  </Show>
                  <a href={link().url} target="_blank" rel="noopener noreferrer" class="text-[13px] text-[var(--accent)]">
                    open the sign-in page
                  </a>
                </div>
              )}
            </Show>
            <Show when={s().note}>
              <p class="text-xs text-muted" data-component="sign-in-note">{s().note!.toLowerCase()}</p>
            </Show>
            <Show when={s().prompt}>
              {(p) => {
                const prompt = p().prompt
                return prompt.type === "select" ? (
                  <div class="flex flex-col gap-1.5" data-component="sign-in-select">
                    <span class="text-xs text-muted">{prompt.message.toLowerCase()}</span>
                    <For each={prompt.options}>
                      {(option) => (
                        <Button class="w-full justify-start" onClick={() => handle?.answer(p().promptId, option.id)}>
                          {option.label.toLowerCase()}
                        </Button>
                      )}
                    </For>
                  </div>
                ) : (
                  <form class="flex flex-col gap-2.5" onSubmit={answer} data-component="sign-in-prompt">
                    <label class="text-xs text-muted" for="sign-in-answer">{prompt.message.toLowerCase()}</label>
                    <input
                      id="sign-in-answer"
                      ref={input}
                      type={prompt.type === "secret" ? "password" : "text"}
                      placeholder={prompt.placeholder}
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck={false}
                      autofocus
                      class={cn(fieldClass, "w-full")}
                    />
                    <div class="flex justify-end">
                      <Button type="submit" variant="primary" data-action="answer-sign-in">
                        continue
                      </Button>
                    </div>
                  </form>
                )
              }}
            </Show>
          </>
        )}
      </Show>
      <Show when={state()?.status === "error" ? state()?.error : null}>
        {(error) => (
          <Notice data-component="sign-in-error">{error().toLowerCase()}</Notice>
        )}
      </Show>
    </div>
  )
}
