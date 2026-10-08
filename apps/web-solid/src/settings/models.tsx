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
import { Button, DetailsButton, Empty, fieldClass, Group, Hint, Item, line, ListRow, Notice, Row, Toggle } from "./kit"
import { ModelSelect, StarButton } from "./model-select"
import { groupForDisplay, modelPrefs, setHidden, toggleFavorite } from "./model-prefs"
import { cn } from "../lib/cn"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "api key",
  device_code: "device code sign-in",
  paste_code: "browser sign-in",
}


/*
 * Settings, models: three groups. The connected providers with their keys, the default model a
 * new chat starts on (one click on any model of a connected provider makes it the default), and
 * a search over the providers not connected yet, each one click from its connect dialog.
 */
export function ModelsPage() {
  const [catalog] = createResource(loadCatalog)
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const saved = (id: string) => connectedProviders().find((p) => p.provider === id)
  const [query, setQuery] = createSignal("")
  // A hundred providers is a wall. The first few show, a search finds any, and "show all" lists them.
  const [allProviders, setAllProviders] = createSignal(false)
  const PREVIEW_PROVIDERS = 12
  const connected = createMemo(() => (catalog()?.providers ?? []).filter((p) => saved(p.id)))
  const available = createMemo(() => {
    const q = query().trim().toLowerCase()
    const rest = (catalog()?.providers ?? []).filter((p) => !saved(p.id))
    return q ? rest.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : rest
  })
  // Enter on the search connects the first hit, so the common case is type, enter, paste the key.
  const connectFirst = (event: SubmitEvent) => {
    event.preventDefault()
    const first = available()[0]
    if (first) setDialog(first)
  }

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
    <div class="flex flex-col gap-8" data-component="models-page">
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
      <Show when={connected().length === 0}>
        <Hint data-component="no-provider">no provider yet. connect one below to start chatting. keys stay on the server and never reach your browser.</Hint>
      </Show>
      <Show when={connected().length > 0}>
        <Group title="defaults">
          <Row id="default-model" label="model" description="a new chat starts on this model. you can change it per chat.">
            <ModelSelect providers={connected()} value={chatModel(null)} onPick={(ref) => setChatModel(null, ref)} label="default model" data-component="default-model" />
          </Row>
        </Group>
      </Show>
      <Show when={connected().length > 0}>
      <Group title="providers" description="keys stay on the server and never reach your browser.">
        <For each={connected()}>{(provider) => <ConnectedProvider provider={provider} info={saved(provider.id)!} />}</For>
      </Group>
      </Show>
      <div data-component="provider-add">
        <Group
          title={connected().length ? "add a provider" : "connect a provider"}
          action={
            <form class="relative flex w-56 max-w-full items-center text-faint" role="search" onSubmit={connectFirst}>
              <svg class="pointer-events-none absolute left-2.5" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
                <circle cx="7" cy="7" r="4.75" />
                <path d="M10.5 10.5L14 14" />
              </svg>
              <input
                type="search"
                class={cn(fieldClass, "w-full pl-8")}
                placeholder="search providers"
                aria-label="search providers"
                autocomplete="off"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                data-component="provider-search"
              />
            </form>
          }
        >
          <ul class="flex flex-col [&>li+li]:border-t [&>li+li]:border-[color-mix(in_oklab,var(--text)_6%,transparent)]" data-component="provider-list">
            <For
              each={query().trim() || allProviders() ? available() : available().slice(0, PREVIEW_PROVIDERS)}
              fallback={
                <li>
                  <Empty>{catalog.loading ? "loading providers" : "no provider matches"}</Empty>
                </li>
              }
            >
              {(provider) => (
                <li style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 40px" }} data-provider={provider.id}>
                  <ListRow
                    icon={<ProviderIcon id={provider.id} width="16" height="16" />}
                    title={provider.name.toLowerCase()}
                    meta={`${provider.models.length} models`}
                    actions={
                      <Button variant="ghost" data-action="connect" onClick={() => setDialog(provider)}>
                        connect
                      </Button>
                    }
                  />
                </li>
              )}
            </For>
          </ul>
          <Show when={!query().trim() && available().length > PREVIEW_PROVIDERS}>
            <div class="px-2 py-1.5">
              <DetailsButton
                open={allProviders()}
                onToggle={() => setAllProviders(!allProviders())}
                label={allProviders() ? "show fewer" : `show all ${available().length}`}
                data-action="show-all-providers"
              />
            </div>
          </Show>
        </Group>
      </div>
      <ConnectDialog provider={dialog()} onClose={() => setDialog(null)} />
    </div>
  )
}

/** One connected provider: its name, how it is connected, and a way to disconnect it. */
function ConnectedProvider(props: { provider: CatalogProvider; info: { kind: string; last4: string } }) {
  const [removing, setRemoving] = createSignal(false)
  async function remove() {
    setRemoving(true)
    try {
      await disconnectProvider(props.provider.id)
    } finally {
      setRemoving(false)
      await refreshConnected()
    }
  }
  const count = () => props.provider.models.length
  const [open, setOpen] = createSignal(false)
  return (
    <Item
      data-provider={props.provider.id}
      data-connected="true"
      icon={<ProviderIcon id={props.provider.id} width="16" height="16" />}
      title={props.provider.name.toLowerCase()}
      meta={`${props.info.kind === "api_key" ? `key ending ${props.info.last4}` : "signed in"} · ${count()} ${count() === 1 ? "model" : "models"}`}
      actions={
        <>
          <DetailsButton open={open()} onToggle={() => setOpen(!open())} label="models" data-action="provider-models" />
          <Button variant="danger" data-action="disconnect" disabled={removing()} onClick={() => void remove()}>
            disconnect
          </Button>
        </>
      }
    >
      {open() ? <ProviderModelList provider={props.provider} /> : undefined}
    </Item>
  )
}

/** Above this many models the list gets a filter, as in t3code. */
const FILTER_THRESHOLD = 8

/**
 * A provider's models, after t3code's provider models section (MIT, ProviderModelsSection.tsx):
 * which the picker shows first (a star) and which it leaves out (a switch), favorites first,
 * then the shown models, then the hidden ones.
 */
function ProviderModelList(props: { provider: CatalogProvider }) {
  const [filter, setFilter] = createSignal("")
  const refOf = (m: CatalogModel) => modelRef(props.provider.id, m.id)
  const refs = () => props.provider.models.map(refOf)
  const hidden = () => new Set(modelPrefs().hidden)
  const matching = createMemo(() => {
    const words = filter().toLowerCase().split(/\s+/).filter(Boolean)
    return props.provider.models.filter((m) => words.every((w) => `${m.name} ${m.id}`.toLowerCase().includes(w)))
  })
  const groups = createMemo(() => groupForDisplay(matching(), refOf, modelPrefs()))
  const favorites = () => props.provider.models.filter((m) => modelPrefs().favorites.includes(refOf(m))).length
  const hiddenCount = () => refs().filter((r) => hidden().has(r)).length
  const allHidden = () => refs().length > 0 && refs().every((r) => hidden().has(r))
  const n = () => props.provider.models.length

  const label = (text: string) => <div class="px-2 pt-3 pb-1 text-[11px] font-medium text-[color-mix(in_oklab,var(--text)_45%,transparent)] first:pt-1">{text}</div>
  const row = (m: CatalogModel) => {
    const ref = refOf(m)
    const off = () => hidden().has(ref)
    return (
      <div class="grid h-8 grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md px-2 hover:bg-[color-mix(in_oklab,var(--text)_4%,transparent)]" classList={{ "opacity-50": off() }} data-model={ref}>
        <StarButton on={modelPrefs().favorites.includes(ref)} name={m.name.toLowerCase()} onToggle={() => toggleFavorite(ref)} />
        <span class="flex min-w-0 items-baseline gap-2">
          <span class="truncate text-[12px] text-text">{m.name.toLowerCase()}</span>
          <Show when={m.name.toLowerCase() !== m.id.toLowerCase()}>
            <code class="truncate font-mono text-[11px] text-[color-mix(in_oklab,var(--text)_40%,transparent)]">{m.id}</code>
          </Show>
        </span>
        <span class="text-[11px] tabular-nums text-[color-mix(in_oklab,var(--text)_45%,transparent)]">
          {formatContext(m.contextWindow)}
          {m.reasoning ? " · reasoning" : ""}
        </span>
        <Toggle label={`show ${m.name.toLowerCase()} in the model picker`} on={!off()} onChange={(on) => setHidden([ref], !on)} />
      </div>
    )
  }
  return (
    <div class="flex flex-col gap-2 pl-10" data-provider-models={props.provider.id}>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={n() > FILTER_THRESHOLD}>
          <input class={cn(fieldClass, "w-56 max-w-full")} placeholder="filter models" aria-label="filter models" spellcheck={false} value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
        </Show>
        <Button variant="ghost" data-action="toggle-all-models" onClick={() => setHidden(refs(), !allHidden())}>
          {allHidden() ? "show all" : "hide all"}
        </Button>
        <span class="ml-auto text-[12px] text-[color-mix(in_oklab,var(--text)_45%,transparent)]">
          {n()} {n() === 1 ? "model" : "models"}
          {favorites() ? ` · ${favorites()} ${favorites() === 1 ? "favorite" : "favorites"}` : ""}
          {hiddenCount() ? ` · ${hiddenCount()} hidden` : ""}
        </span>
      </div>
      <div class="-mx-2 max-h-72 overflow-y-auto">
        <Show when={matching().length} fallback={<p class="px-2 py-2 text-[12px] text-[color-mix(in_oklab,var(--text)_50%,transparent)]">no models match</p>}>
          <Show when={groups().favorites.length}>
            {label("favorites")}
            <For each={groups().favorites}>{row}</For>
          </Show>
          <Show when={groups().shown.length}>
            <Show when={groups().favorites.length}>{label("all")}</Show>
            <For each={groups().shown}>{row}</For>
          </Show>
          <Show when={groups().hidden.length}>
            {label("hidden from picker")}
            <For each={groups().hidden}>{row}</For>
          </Show>
        </Show>
      </div>
    </div>
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
