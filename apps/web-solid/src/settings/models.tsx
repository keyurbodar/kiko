import { A } from "@solidjs/router"
import { For, Show, Suspense, createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { formatContext, loadCatalog, modelRef, type CatalogModel, type CatalogProvider, type ConnectMethod } from "./catalog"
import { connectedProviders, connectedReady, refreshConnected } from "./connected"
import { Moment } from "../mascot/pixel/lazy"
import { connectProvider, disconnectProvider } from "./credentials"
import { startSignIn, type SignIn, type SignInHandle } from "./provider-login"
import { Button, Empty, fieldClass, Group, Hint, Item, line, Notice, Pill, rowLine, Toggle } from "./kit"
import { hiddenModels, setHidden } from "./model-prefs"
import { cn } from "../lib/cn"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "api key",
  device_code: "device code sign-in",
  paste_code: "browser sign-in",
}


/*
 * Settings, providers and models, after opencode's settings (MIT, packages/app/src/components/
 * settings-v2/providers.tsx, models.tsx). Providers: the connected ones, each with how it is
 * connected and a way out, then a few popular ones to connect and a way to see them all. Models:
 * a search, then each connected provider's models in a group that folds, each with one switch
 * for whether the chat's model picker offers it. There is no default model to set: a new chat
 * starts on the model picked last.
 */

const faint = "text-[color-mix(in_oklab,var(--text)_45%,transparent)]"

/** Popular providers, in the order offered, with one line each. Only those in the catalog show. */
const POPULAR: readonly { id: string; note: string }[] = [
  { id: "opencode-go", note: "low-cost open models from opencode." },
  { id: "opencode", note: "models picked and tested by the opencode team." },
  { id: "anthropic", note: "claude models." },
  { id: "openai", note: "gpt models." },
  { id: "google", note: "gemini models." },
  { id: "openrouter", note: "many providers' models behind one key." },
  { id: "github-copilot", note: "the models in your copilot plan." },
]

/** The catalog and who is connected, shared by both pages. */
function useProviders() {
  const [catalog] = createResource(loadCatalog)
  const saved = (id: string) => connectedProviders().find((p) => p.provider === id)
  const connected = createMemo(() => (catalog()?.providers ?? []).filter((p) => saved(p.id)))
  return { catalog, saved, connected }
}

export function ProvidersPage() {
  const { catalog, saved, connected } = useProviders()
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const available = createMemo(() => (catalog()?.providers ?? []).filter((p) => !saved(p.id)))
  const popular = createMemo(() =>
    POPULAR.flatMap(({ id, note }) => {
      const provider = available().find((p) => p.id === id)
      return provider ? [{ provider, note }] : []
    }),
  )

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
    <div class="flex flex-col gap-8" data-component="providers-page">
      <Show when={cheer()}>
        <div class="flex items-center gap-3 rounded-lg bg-[var(--accent-wash)] px-4 py-2.5" data-component="first-provider-cheer" role="status">
          <Suspense>
            <Moment kind="cheer" faces={["kiko", "scout", "budget"]} />
          </Suspense>
          <p class="text-[13px] text-text">connected. your agents can reply now.</p>
        </div>
      </Show>
      <Show when={catalog.error}>
        <Notice data-component="catalog-error">the model catalog did not load. reload to try again.</Notice>
      </Show>
      <Group title="connected">
        <For each={connected()} fallback={<Empty data-component="no-provider">{catalog.loading ? "loading" : "no provider yet. connect one below to start chatting."}</Empty>}>
          {(provider) => <ConnectedRow provider={provider} info={saved(provider.id)!} />}
        </For>
      </Group>
      <div data-component="provider-add">
        <Group title={connected().length ? "add another" : "popular"}>
          <For each={popular()}>
            {({ provider, note }) => (
              <Item
                data-provider={provider.id}
                icon={<ProviderIcon id={provider.id} width="16" height="16" />}
                title={provider.name.toLowerCase()}
                meta={note}
                actions={
                  <Button data-action="connect" onClick={() => setDialog(provider)}>
                    <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                      <path d="M8 3.5v9M3.5 8h9" />
                    </svg>
                    connect
                  </Button>
                }
              />
            )}
          </For>
        </Group>
        <button type="button" class="mt-3 cursor-pointer text-[13px] font-medium text-[var(--accent)] hover:underline" data-action="view-all-providers" onClick={() => setBrowsing(true)}>
          view all providers
        </button>
      </div>
      <AddProviderDialog
        open={browsing()}
        loading={catalog.loading}
        providers={available()}
        onClose={() => setBrowsing(false)}
        onPick={(provider) => {
          setBrowsing(false)
          setDialog(provider)
        }}
      />
      <ConnectDialog provider={dialog()} onClose={() => setDialog(null)} />
    </div>
  )
}

/** A connected provider: its name, how it is connected, and a way to disconnect it. */
function ConnectedRow(props: { provider: CatalogProvider; info: { kind: string; last4: string } }) {
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
  return (
    <Item
      data-provider={props.provider.id}
      data-connected="true"
      icon={<ProviderIcon id={props.provider.id} width="16" height="16" />}
      title={
        <>
          <span class="truncate">{props.provider.name.toLowerCase()}</span>
          <Pill>{props.info.kind === "api_key" ? `api key ••${props.info.last4}` : "signed in"}</Pill>
        </>
      }
      actions={
        <Button variant="ghost" data-action="disconnect" disabled={removing()} onClick={() => void remove()}>
          disconnect
        </Button>
      }
    />
  )
}

const COLLAPSED_KEY = "kiko.models-collapsed"

function readCollapsed(): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}")
    return value && typeof value === "object" ? value : {}
  } catch {
    return {}
  }
}

export function ModelsPage() {
  const { catalog, connected } = useProviders()
  const [query, setQuery] = createSignal("")
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>(readCollapsed())
  const fold = (id: string, value: boolean) => {
    const next = { ...collapsed(), [id]: value }
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
    } catch {}
  }
  const groups = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return connected()
      .map((provider) => ({
        provider,
        models: provider.models
          .filter((m) => words.every((w) => `${provider.name} ${m.name} ${m.id}`.toLowerCase().includes(w)))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.models.length > 0)
  })
  const searching = () => query().trim().length > 0

  return (
    <div class="flex flex-col gap-6" data-component="models-page">
      <Show
        when={connected().length}
        fallback={
          <Hint>
            {catalog.loading ? "loading" : "no provider yet. "}
            <Show when={!catalog.loading}>
              <A href="/settings/providers" class="text-[var(--accent)] hover:underline">
                connect one
              </A>{" "}
              to see its models here.
            </Show>
          </Hint>
        }
      >
        <input
          type="search"
          class={cn(fieldClass, "h-8 w-full")}
          placeholder="search models"
          aria-label="search models"
          spellcheck={false}
          autocomplete="off"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          data-component="model-search"
        />
        <For each={groups()} fallback={<Hint>no models match "{query()}"</Hint>}>
          {(group) => {
            const open = () => searching() || !collapsed()[group.provider.id]
            return (
              <section class="flex flex-col gap-2.5" data-component="models-provider" data-provider={group.provider.id} data-expanded={open() ? "" : undefined}>
                <h2>
                  <button
                    type="button"
                    class="-ml-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-2 pl-1 text-[13px] font-medium text-text outline-none hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-default disabled:hover:bg-transparent"
                    aria-expanded={open()}
                    disabled={searching()}
                    onClick={() => fold(group.provider.id, open())}
                  >
                    <svg class={cn("size-4 shrink-0", faint, !open() && "-rotate-90")} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M5.4 6.75c-.2-.33.04-.75.42-.75h4.38c.39 0 .63.42.43.75l-2.19 3.76a.5.5 0 0 1-.87 0z" />
                    </svg>
                    <ProviderIcon id={group.provider.id} width="16" height="16" />
                    {group.provider.name.toLowerCase()}
                    <span class={cn("font-normal", faint)}>{group.models.length}</span>
                  </button>
                </h2>
                <Show when={open()}>
                  <div class="overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--text)_3%,transparent)] shadow-[inset_0_0_0_0.5px_color-mix(in_oklab,var(--text)_16%,transparent)]">
                    <For each={group.models}>
                      {(m) => {
                        const ref = modelRef(group.provider.id, m.id)
                        const shown = () => !hiddenModels().includes(ref)
                        return (
                          <div class={cn("flex min-h-12 items-center gap-4 px-5 py-2.5", rowLine)} data-model={ref}>
                            <span class={cn("min-w-0 flex-1 truncate text-[13px] font-medium", shown() ? "text-text" : faint)}>{m.name.toLowerCase()}</span>
                            <span class={cn("hidden shrink-0 text-[12px] tabular-nums sm:inline", faint)}>
                              {formatContext(m.contextWindow)}
                              {m.reasoning ? " · reasoning" : ""}
                            </span>
                            <Toggle label={`show ${m.name.toLowerCase()} in the model picker`} on={shown()} onChange={(on) => setHidden([ref], !on)} />
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </section>
            )
          }}
        </For>
      </Show>
    </div>
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
