import { A } from "@solidjs/router"
import { For, Show, Suspense, createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { formatContext, loadCatalog, modelRef, type CatalogModel, type CatalogProvider, type ConnectMethod } from "./catalog"
import { connectedProviders, connectedReady, refreshConnected } from "./connected"
import { Moment } from "../mascot/lazy"
import { connectProvider, disconnectProvider } from "./credentials"
import { startSignIn, type SignIn, type SignInHandle } from "./provider-login"
import { Button, fieldClass, Group, Hint, IconButton, Item, muted, Notice, Pill, Row, Toggle } from "./kit"
import { Dialog } from "../lib/dialog"
import { hiddenModels, setHidden } from "./model-prefs"
import { cn } from "../lib/cn"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "API key",
  device_code: "Device code sign-in",
  paste_code: "Browser sign-in",
}


/*
 * Settings, providers and models, after opencode's settings (MIT, packages/app/src/components/
 * settings-v2/providers.tsx, models.tsx). Providers: the connected ones, each with how it is
 * connected and a way out, then a few popular ones to connect and a way to see them all. Models:
 * a search, then each connected provider's models in a group that folds, each with one switch
 * for whether the chat's model picker offers it. There is no default model to set: a new chat
 * starts on the model picked last.
 */

/** Popular providers, in the order offered, with one line each. Only those in the catalog show. */
const POPULAR: readonly { id: string; note: string }[] = [
  { id: "opencode-go", note: "Low-cost open models from OpenCode." },
  { id: "opencode", note: "Models picked and tested by the OpenCode team." },
  { id: "anthropic", note: "Claude models." },
  { id: "openai", note: "GPT models." },
  { id: "google", note: "Gemini models." },
  { id: "openrouter", note: "Many providers' models behind one key." },
  { id: "github-copilot", note: "The models in your Copilot plan." },
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
          <p class="text-[13px] text-text">Connected. Your agents can reply now.</p>
        </div>
      </Show>
      <Show when={catalog.error}>
        <Notice data-component="catalog-error">The model catalog did not load. Reload to try again.</Notice>
      </Show>
      {/* With nothing connected the page opens on the popular ones; an empty card would say nothing. */}
      <Show when={connected().length}>
        <Group title="Connected">
          <For each={connected()}>{(provider) => <ConnectedRow provider={provider} info={saved(provider.id)!} />}</For>
        </Group>
      </Show>
      <Group
        title={connected().length ? "Add another" : "Popular"}
        data-component="provider-add"
        bare={!popular().length}
        action={
          <Button variant="ghost" data-action="view-all-providers" onClick={() => setBrowsing(true)}>
            View all providers
          </Button>
        }
      >
        <For
          each={popular()}
          fallback={
            <Show when={!catalog.error}>
              <Hint data-component="no-provider">{catalog.loading ? "Loading" : "Every popular provider is connected."}</Hint>
            </Show>
          }
        >
          {({ provider, note }) => (
            <Item
              data-provider={provider.id}
              icon={<ProviderIcon id={provider.id} width="16" height="16" />}
              title={provider.name}
              meta={note}
              actions={
                <Button data-action="connect" onClick={() => setDialog(provider)}>
                  <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                    <path d="M8 3.5v9M3.5 8h9" />
                  </svg>
                  Connect
                </Button>
              }
            />
          )}
        </For>
      </Group>
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
      title={props.provider.name}
      meta={props.info.kind === "api_key" ? `API key ••${props.info.last4}` : "Signed in"}
      actions={
        <Button variant="danger" data-action="disconnect" disabled={removing()} onClick={() => void remove()}>
          Disconnect
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
    <div class="flex flex-col gap-8" data-component="models-page">
      <Show
        when={connected().length}
        fallback={
          <Hint>
            {catalog.loading ? "Loading" : "No providers connected. "}
            <Show when={!catalog.loading}>
              <A href="/settings/providers" class="text-[var(--accent)] hover:underline">
                Connect one
              </A>{" "}
              to see its models here.
            </Show>
          </Hint>
        }
      >
        <input
          type="search"
          class={cn(fieldClass, "w-full")}
          placeholder="Search models"
          aria-label="Search models"
          spellcheck={false}
          autocomplete="off"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          data-component="model-search"
        />
        <For each={groups()} fallback={<Hint>No models match "{query()}"</Hint>}>
          {(group) => {
            const open = () => searching() || !collapsed()[group.provider.id]
            return (
              <Group
                data-component="models-provider"
                data-provider={group.provider.id}
                data-expanded={open() ? "" : undefined}
                bare={!open()}
                title={
                  <span class="flex items-center gap-2">
                    <ProviderIcon id={group.provider.id} width="16" height="16" />
                    {group.provider.name}
                    <span class={cn("tabular-nums", muted)}>{group.models.length}</span>
                  </span>
                }
                action={
                  <IconButton label={open() ? `Hide ${group.provider.name} models` : `Show ${group.provider.name} models`} aria-expanded={open()} disabled={searching()} onClick={() => fold(group.provider.id, open())}>
                    <svg class={cn("size-3.5", !open() && "-rotate-90")} viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </IconButton>
                }
              >
                <Show when={open()}>
                  <For each={group.models}>
                    {(m) => {
                      const ref = modelRef(group.provider.id, m.id)
                      return (
                        <Row
                          data-model={ref}
                          label={
                            <>
                              <span class="truncate">{m.name}</span>
                              <Show when={m.reasoning}>
                                <Pill>Reasoning</Pill>
                              </Show>
                            </>
                          }
                          description={`${formatContext(m.contextWindow)} context`}
                        >
                          <Toggle label={`Show ${m.name} in the model picker`} on={!hiddenModels().includes(ref)} onChange={(on) => setHidden([ref], !on)} />
                        </Row>
                      )
                    }}
                  </For>
                </Show>
              </Group>
            )
          }}
        </For>
      </Show>
    </div>
  )
}

/**
 * Adding a provider, after t3code's add-provider dialog: a search over every provider not yet
 * connected and one list of them. Choosing one goes straight to its connect step.
 */
function AddProviderDialog(props: { open: boolean; loading: boolean; providers: readonly CatalogProvider[]; onClose: () => void; onPick: (provider: CatalogProvider) => void }) {
  const [query, setQuery] = createSignal("")
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase()
    return q ? props.providers.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : props.providers
  })
  return (
    <Dialog
      open={props.open}
      onClose={() => {
        setQuery("")
        props.onClose()
      }}
      title="Add a provider"
      size="md"
      class="h-[min(560px,86dvh)]"
      bodyClass="flex flex-col gap-3 overflow-hidden px-3"
      data-component="provider-browser"
    >
      <form
        role="search"
        class="px-2"
        onSubmit={(e) => {
          e.preventDefault()
          const first = shown()[0]
          if (first) props.onPick(first)
        }}
      >
        <input
          type="search"
          class={cn(fieldClass, "w-full")}
          placeholder="Search providers"
          aria-label="Search providers"
          autocomplete="off"
          value={query()}
          ref={(el) => requestAnimationFrame(() => el.focus())}
          onInput={(e) => setQuery(e.currentTarget.value)}
          data-component="provider-search"
        />
      </form>
      <ul class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-component="provider-list">
        <For each={shown()} fallback={<li class={cn("px-2 text-[13px]", muted)}>{props.loading ? "Loading providers" : "No provider matches"}</li>}>
          {(provider) => (
            <li data-provider={provider.id}>
              <button
                type="button"
                class="flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left outline-none hover:bg-[var(--kit-hover)] focus-visible:bg-[var(--kit-hover)]"
                data-action="connect"
                onClick={() => props.onPick(provider)}
              >
                <ProviderIcon id={provider.id} width="16" height="16" />
                <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{provider.name}</span>
                <span class={cn("shrink-0 text-[12px] tabular-nums", muted)}>{provider.models.length} {provider.models.length === 1 ? "model" : "models"}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Dialog>
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
      setError(e instanceof Error ? e.message : "Could not save the key.")
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setError(null)
    props.onClose()
  }
  const byKey = () => props.provider?.connect.includes("api_key") ?? false

  return (
    <Dialog
      open={props.provider !== null}
      onClose={close}
      title={<span data-component="connect-title">Connect {props.provider?.name}</span>}
      data-component="provider-connect"
      footer={
        <Show when={byKey()}>
          <Button variant="ghost" data-action="cancel-connect" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="provider-key-form" variant="primary" disabled={busy()} data-action="save-key">
            Save key
          </Button>
        </Show>
      }
    >
      <div class="flex flex-col gap-4">
        <For each={props.provider?.connect ?? []}>
          {(method) =>
            method === "api_key" ? (
              <form id="provider-key-form" class="flex flex-col gap-2" onSubmit={submit} data-method="api_key">
                <label class="text-[13px] font-medium text-text" for="provider-key">
                  API key
                </label>
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
      </div>
    </Dialog>
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
            <Button data-action="sign-in" onClick={start}>
              {state()?.status === "error" ? "Try again" : "Sign in"}
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
            Cancel
          </Button>
        </Show>
      </div>
      <Show when={running() ? state() : null}>
        {(s) => (
          <>
            <Show when={s().code}>
              {(code) => (
                <div class="flex flex-col gap-1" data-component="device-code">
                  <span class={cn("text-[12px]", muted)}>Enter this code at the provider</span>
                  <span class="select-all font-mono text-lg tracking-widest text-text">{code().userCode}</span>
                  <a
                    href={code().verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-xs text-[var(--accent)]"
                  >
                    Open {code().verificationUri.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
            </Show>
            <Show when={s().link}>
              {(link) => (
                <div class="flex flex-col gap-1" data-component="sign-in-link">
                  <Show when={link().instructions}>
                    <span class={cn("text-[12px]", muted)}>{link().instructions}</span>
                  </Show>
                  <a href={link().url} target="_blank" rel="noopener noreferrer" class="text-[13px] text-[var(--accent)]">
                    Open the sign-in page
                  </a>
                </div>
              )}
            </Show>
            <Show when={s().note}>
              <p class={cn("text-[12px]", muted)} data-component="sign-in-note">{s().note}</p>
            </Show>
            <Show when={s().prompt}>
              {(p) => {
                const prompt = p().prompt
                return prompt.type === "select" ? (
                  <div class="flex flex-col gap-1.5" data-component="sign-in-select">
                    <span class={cn("text-[12px]", muted)}>{prompt.message}</span>
                    <For each={prompt.options}>
                      {(option) => (
                        <Button class="w-full justify-start" onClick={() => handle?.answer(p().promptId, option.id)}>
                          {option.label}
                        </Button>
                      )}
                    </For>
                  </div>
                ) : (
                  <form class="flex flex-col gap-2.5" onSubmit={answer} data-component="sign-in-prompt">
                    <label class={cn("text-[12px]", muted)} for="sign-in-answer">{prompt.message}</label>
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
                        Continue
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
          <Notice data-component="sign-in-error">{error()}</Notice>
        )}
      </Show>
    </div>
  )
}
