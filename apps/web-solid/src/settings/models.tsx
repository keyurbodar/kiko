import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { formatContext, loadCatalog, modelRef, type CatalogProvider, type ConnectMethod } from "./catalog"
import { isJudgeOnly, JUDGE_NOTE, modelProviders } from "./provider-kinds"
import { connectedProviders, connectedReady, refreshConnected } from "./connected"
import { connectProvider, disconnectProvider } from "./credentials"
import { startSignIn, type SignIn, type SignInHandle } from "./provider-login"
import { Button, Empty, fieldClass, Group, Hint, muted, Notice, Toggle } from "./kit"
import { VList } from "virtua/solid"
import { Dialog } from "../lib/dialog"
import { hiddenModels, setHidden } from "./model-prefs"
import { cn } from "../lib/cn"
import { AgentModels } from "./agent-models"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "API key",
  device_code: "Device code sign-in",
  paste_code: "Browser sign-in",
}

const POPULAR: readonly { id: string; note: string }[] = [
  { id: "opencode-go", note: "Low-cost open models from OpenCode." },
  { id: "opencode", note: "Models picked and tested by the OpenCode team." },
  { id: "anthropic", note: "Claude models." },
  { id: "openai", note: "GPT models." },
  { id: "google", note: "Gemini models." },
  { id: "openrouter", note: "Many providers' models behind one key." },
  { id: "github-copilot", note: "The models in your Copilot plan." },
]

type Pick = { kind: "all" } | { kind: "provider"; id: string }

export function ModelsPage() {
  const [catalog] = createResource(loadCatalog)
  const saved = (id: string) => connectedProviders().find((p) => p.provider === id)
  const connected = createMemo(() => (catalog()?.providers ?? []).filter((p) => saved(p.id)))
  const available = createMemo(() => (catalog()?.providers ?? []).filter((p) => !saved(p.id)))
  const popular = createMemo(() =>
    POPULAR.flatMap(({ id, note }) => {
      const provider = available().find((p) => p.id === id)
      return provider ? [{ provider, note }] : []
    }).concat(available().filter(isJudgeOnly).map((provider) => ({ provider, note: JUDGE_NOTE }))),
  )
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const [pick, setPick] = createSignal<Pick>({ kind: "all" })
  const [query, setQuery] = createSignal("")
  const hidden = createMemo(() => new Set(hiddenModels()))

  const current = () => {
    const p = pick()
    return p.kind === "provider" ? connected().find((c) => c.id === p.id) : undefined
  }
  const rows = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    const from = current() ? [current()!] : connected()
    return from.flatMap((provider) =>
      provider.models
        .filter((m) => words.every((w) => `${provider.name} ${m.name} ${m.id}`.toLowerCase().includes(w)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((model) => ({ provider, model, ref: modelRef(provider.id, model.id) })),
    )
  })
  const shownCount = () => rows().filter((r) => !hidden().has(r.ref)).length

  const [cheer, setCheer] = createSignal(false)
  createEffect(
    on(
      () => (connectedReady() ? modelProviders(connectedProviders()).length : -1),
      (count, prev) => {
        if (prev !== 0 || count < 1) return
        setCheer(true)
        const timer = setTimeout(() => setCheer(false), 2400)
        onCleanup(() => clearTimeout(timer))
      },
    ),
  )
  createEffect(() => {
    const p = pick()
    if (p.kind === "provider" && connectedReady() && !connected().some((c) => c.id === p.id)) setPick({ kind: "all" })
  })

  const railRow = (active: boolean) =>
    cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-md outline-none", active ? "bg-accent-strong text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")

  return (
    <div class="flex flex-col gap-6" data-component="models-page">
      <AgentModels />
      <Show when={cheer()}>
        <p class="rounded-md bg-ring-wash px-3 py-2 text-md text-foreground" data-component="first-provider-cheer" role="status">
          Connected. Your agents can reply now.
        </p>
      </Show>
      <Show when={catalog.error}>
        <Notice data-component="catalog-error">The model catalog did not load. Reload to try again.</Notice>
      </Show>

      <Show
        when={connected().length}
        fallback={
          <Group title="Connect a provider" data-component="provider-add" bare action={<Button variant="ghost" data-action="view-all-providers" onClick={() => setBrowsing(true)}>All providers</Button>}>
            <div class="grid grid-cols-1 gap-2 @min-[560px]/settings:grid-cols-2">
              <For each={popular()} fallback={<Hint>{catalog.loading ? "Loading" : "No providers found."}</Hint>}>
                {({ provider, note }) => (
                  <button
                    type="button"
                    class="flex items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2.5 text-left hover:bg-accent"
                    data-provider={provider.id}
                    data-action="connect"
                    onClick={() => setDialog(provider)}
                  >
                    <ProviderIcon id={provider.id} width="16" height="16" />
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate text-md font-medium text-foreground">{provider.name}</span>
                      <span class="truncate text-sm text-muted-foreground">{note}</span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Group>
        }
      >
        <div class="grid grid-cols-1 gap-4 @min-[560px]/settings:grid-cols-[180px_minmax(0,1fr)]">
          <nav class="flex flex-col gap-0.5" aria-label="Providers" data-component="provider-rail">
            <button type="button" class={railRow(pick().kind === "all")} aria-current={pick().kind === "all" ? "true" : undefined} onClick={() => setPick({ kind: "all" })}>
              <span class="min-w-0 flex-1 truncate">All models</span>
            </button>
            <For each={connected()}>
              {(provider) => {
                const info = () => saved(provider.id)
                const on = () => current()?.id === provider.id
                return (
                  <button
                    type="button"
                    class={railRow(on())}
                    aria-current={on() ? "true" : undefined}
                    data-provider={provider.id}
                    data-connected="true"
                    data-refused={info()?.refused ? "true" : undefined}
                    onClick={() => setPick({ kind: "provider", id: provider.id })}
                  >
                    <ProviderIcon id={provider.id} width="14" height="14" />
                    <span class="min-w-0 flex-1 truncate">{provider.name}</span>
                    <Show when={info()?.refused} fallback={<span class="shrink-0 text-xs tabular-nums text-secondary-label">{provider.models.length || ""}</span>}>
                      <span class="size-1.5 shrink-0 rounded-full bg-error" role="img" aria-label="Key refused" />
                    </Show>
                  </button>
                )
              }}
            </For>
            <button type="button" class={cn(railRow(false), "mt-1")} data-action="view-all-providers" onClick={() => setBrowsing(true)}>
              <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <path d="M8 3.5v9M3.5 8h9" />
              </svg>
              <span class="min-w-0 flex-1 truncate">Add provider</span>
            </button>
          </nav>

          <section class="flex min-w-0 flex-col gap-2" data-component="model-list">
            <Show when={current()}>
              {(provider) => (
                <div class="flex items-center gap-3 px-1" data-component="provider-detail" data-provider={provider().id}>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-md font-medium text-foreground">{provider().name}</span>
                    <span class={cn("truncate text-sm", saved(provider().id)?.refused ? "text-error" : muted)}>
                      {saved(provider().id)?.refused ? "Key refused. Connect again with a new key." : saved(provider().id)?.kind === "api_key" ? `API key ••${saved(provider().id)?.last4}` : "Signed in"}
                    </span>
                  </div>
                  <Show when={saved(provider().id)?.refused}>
                    <Button data-action="reconnect" onClick={() => setDialog(provider())}>Reconnect</Button>
                  </Show>
                  <DisconnectButton id={provider().id} />
                </div>
              )}
            </Show>
            <div class="flex items-center gap-2">
              <input
                type="search"
                class={cn(fieldClass, "min-w-0 flex-1")}
                placeholder="Search models"
                aria-label="Search models"
                spellcheck={false}
                autocomplete="off"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                data-component="model-search"
              />
            </div>
            <div class="flex items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
              <span class="tabular-nums">
                {shownCount()} of {rows().length} in the picker
              </span>
              <span class="flex gap-1">
                <Button variant="ghost" disabled={shownCount() === rows().length} onClick={() => setHidden(rows().map((r) => r.ref), false)}>
                  Show all
                </Button>
                <Button variant="ghost" disabled={shownCount() === 0} onClick={() => setHidden(rows().map((r) => r.ref), true)}>
                  Hide all
                </Button>
              </span>
            </div>
            <Show when={rows().length} fallback={<div class="kit-card"><Empty>{query().trim() ? `No models match "${query().trim()}"` : "This provider has no chat models."}</Empty></div>}>
              <VList class="kit-card" style={{ height: `${Math.min(rows().length * 36, 540)}px` }} data={rows()} itemSize={36}>
                {(r) => (
                  <div
                    class="flex h-9 cursor-pointer items-center gap-2.5 border-b border-border px-3 hover:bg-accent"
                    data-model={r.ref}
                    onClick={() => setHidden([r.ref], !hidden().has(r.ref))}
                  >
                    <Show when={!current()}>
                      <ProviderIcon id={r.provider.id} width="14" height="14" />
                    </Show>
                    <span class="min-w-0 flex-1 truncate text-md text-foreground" title={r.model.id}>
                      {r.model.name}
                    </span>
                    <Show when={r.model.reasoning}>
                      <span class="shrink-0 text-xs text-secondary-label">Reasoning</span>
                    </Show>
                    <span class="w-12 shrink-0 text-right text-xs tabular-nums text-secondary-label">{formatContext(r.model.contextWindow)}</span>
                    <span onClick={(event) => event.stopPropagation()}>
                      <Toggle label={`Show ${r.model.name} in the model picker`} on={!hidden().has(r.ref)} onChange={(on) => setHidden([r.ref], !on)} />
                    </span>
                  </div>
                )}
              </VList>
            </Show>
          </section>
        </div>
      </Show>

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

function DisconnectButton(props: { id: string }) {
  const [removing, setRemoving] = createSignal(false)
  const [sure, setSure] = createSignal(false)
  async function remove() {
    setRemoving(true)
    try {
      await disconnectProvider(props.id)
    } finally {
      setRemoving(false)
      setSure(false)
      await refreshConnected()
    }
  }
  return (
    <Button variant={sure() ? "danger" : "ghost"} data-action="disconnect" disabled={removing()} onBlur={() => setSure(false)} onClick={() => (sure() ? void remove() : setSure(true))}>
      {sure() ? "Disconnect for good" : "Disconnect"}
    </Button>
  )
}

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
                class="flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left outline-none hover:bg-[var(--accent)] focus-visible:bg-[var(--accent)]"
                data-action="connect"
                onClick={() => props.onPick(provider)}
              >
                <ProviderIcon id={provider.id} width="16" height="16" />
                <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{provider.name}</span>
                <span class={cn("shrink-0 text-[12px] tabular-nums", muted)}>{provider.models.length} {provider.models.length === 1 ? "model" : "models"}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Dialog>
  )
}

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
                <label class="text-[13px] font-medium text-foreground" for="provider-key">
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
                <Show when={props.provider && isJudgeOnly(props.provider)}>
                  <Hint>{JUDGE_NOTE}</Hint>
                </Show>
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
        <span class="text-[13px] text-foreground">{METHOD_LABEL[props.method]}</span>
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
                  <span class="select-all font-mono text-lg tracking-widest text-foreground">{code().userCode}</span>
                  <a
                    href={code().verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-xs text-[var(--ring)]"
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
                  <a href={link().url} target="_blank" rel="noopener noreferrer" class="text-[13px] text-[var(--ring)]">
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
