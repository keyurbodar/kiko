import { SearchField } from "@kiko/ui/v2/search-field"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createQuery } from "../state/runtime"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { formatContext, catalogQuery, modelRef, type CatalogProvider, type ConnectMethod } from "./catalog"
import { isJudgeOnly, JUDGE_NOTE, modelProviders } from "./provider-kinds"
import { connectedProviders, connectedReady } from "./connected"
import { checkProvider, connectProvider, disconnectProvider } from "./credentials"
import { clearReconnect, FIX_LABEL, PROBLEM_LINE, PROBLEM_SHORT, reconnectTarget } from "./provider-problem"
import { startSignIn, type SignIn, type SignInHandle } from "./provider-login"
import { Button, Empty, fieldClass, Group, Hint, muted, Notice, Skeleton, Spinner, Toggle } from "./kit"
import { VList } from "virtua/solid"
import { Dialog } from "../lib/dialog"
import { hiddenModels, setHidden } from "./model-prefs"
import { cn } from "../lib/cn"
import { AgentModels } from "./agent-models"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { TabsPill, TabsV2 as Tabs } from "@kiko/ui/v2/tabs-v2"
import { modelsTab, setModelsTab, type ModelsTab } from "./models-tab"
import { SECRET_FIELD } from "../lib/secret-field"

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
  const [wantsCatalog, setWantsCatalog] = createSignal(false)
  createEffect(() => {
    if (modelsTab() === "providers") setWantsCatalog(true)
  })
  const catalog = createQuery(() => (wantsCatalog() ? catalogQuery() : null))
  createEffect(() => {
    if (reconnectTarget()) setWantsCatalog(true)
  })
  const saved = (id: string) => connectedProviders().find((p) => p.provider === id)
  const status = (id: string) => {
    const info = saved(id)
    if (info?.problem) return PROBLEM_LINE[info.problem]
    return info?.kind === "api_key" ? `API key ••${info.last4}` : "Signed in"
  }
  const connected = createMemo(() => (catalog()?.providers ?? []).filter((p) => saved(p.id)))
  const available = createMemo(() => (catalog()?.providers ?? []).filter((p) => !saved(p.id)))
  const popular = createMemo(() =>
    POPULAR.flatMap(({ id, note }) => {
      const provider = available().find((p) => p.id === id)
      return provider ? [{ provider, note }] : []
    }).concat(
      available()
        .filter(isJudgeOnly)
        .map((provider) => ({ provider, note: JUDGE_NOTE })),
    ),
  )
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const [pick, setPick] = createSignal<Pick>({ kind: "all" })
  createEffect(() => {
    const wanted = reconnectTarget()
    const provider = wanted ? catalog()?.providers.find((p) => p.id === wanted) : undefined
    if (!provider) return
    setPick({ kind: "provider", id: provider.id })
    setDialog(provider)
    clearReconnect()
  })
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
    cn(
      "flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-ui outline-none",
      active ? "bg-active text-fg" : "text-fg2 hover:bg-hover hover:text-fg",
    )

  return (
    <div class="flex flex-col gap-6" data-component="models-page">
      <Show when={cheer()}>
        <p
          class="rounded-control bg-active px-3 py-2 text-ui text-fg"
          data-component="first-provider-cheer"
          role="status"
        >
          Connected. Your agents can reply now.
        </p>
      </Show>
      <Show when={catalog.error}>
        <Notice data-component="catalog-error">The model catalog did not load. Reload to try again.</Notice>
      </Show>

      <Tabs
        value={modelsTab()}
        onChange={(tab) => setModelsTab(tab as ModelsTab)}
        class="flex flex-col gap-5"
        data-component="models-tabs"
      >
        <Tabs.List class="kit-tabs" aria-label="Models">
          <TabsPill />
          <Tabs.Trigger value="agents" class="kit-tab" data-tab="agents">
            Agents
          </Tabs.Trigger>
          <Tabs.Trigger value="providers" class="kit-tab" data-tab="providers">
            Providers
          </Tabs.Trigger>
        </Tabs.List>
        <Show when={modelsTab() === "agents"}>
          <AgentModels />
        </Show>
        <Show when={modelsTab() === "providers"}>
          <Show
            when={connected().length}
            fallback={
              <Group
                title="Connect a provider"
                data-component="provider-add"
                bare
                action={
                  <Button variant="ghost" data-action="view-all-providers" onClick={() => setBrowsing(true)}>
                    All providers
                  </Button>
                }
              >
                <div class="grid grid-cols-1 gap-2 @min-[560px]/settings:grid-cols-2">
                  <Show when={connectedReady() && !!catalog()} fallback={<ProviderSkeletons />}>
                    <For each={popular()} fallback={<Hint>No providers found.</Hint>}>
                      {({ provider, note }) => (
                        <button
                          type="button"
                          class="flex items-center gap-3 rounded-row border border-line bg-panel px-3 py-2.5 text-left hover:bg-hover"
                          data-provider={provider.id}
                          data-action="connect"
                          onClick={() => setDialog(provider)}
                        >
                          <ProviderIcon id={provider.id} width="16" height="16" />
                          <span class="flex min-w-0 flex-col">
                            <span class="truncate text-ui font-medium text-fg">{provider.name}</span>
                            <span class="truncate text-label text-fg2">{note}</span>
                          </span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </Group>
            }
          >
            <div class="grid grid-cols-1 gap-4 @min-[560px]/settings:grid-cols-[180px_minmax(0,1fr)]">
              <nav class="flex flex-col gap-0.5" aria-label="Providers" data-component="provider-rail">
                <button
                  type="button"
                  class={railRow(pick().kind === "all")}
                  aria-current={pick().kind === "all" ? "true" : undefined}
                  onClick={() => setPick({ kind: "all" })}
                >
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
                        data-problem={info()?.problem}
                        onClick={() => setPick({ kind: "provider", id: provider.id })}
                      >
                        <ProviderIcon id={provider.id} width="14" height="14" />
                        <span class="min-w-0 flex-1 truncate">{provider.name}</span>
                        <Show
                          when={info()?.problem}
                          fallback={
                            <span class="shrink-0 text-hint tabular-nums text-fg4">{provider.models.length || ""}</span>
                          }
                        >
                          {(problem) => (
                            <span
                              class="size-1.5 shrink-0 rounded-full bg-bad"
                              role="img"
                              aria-label={PROBLEM_SHORT[problem()]}
                            />
                          )}
                        </Show>
                      </button>
                    )
                  }}
                </For>
                <button
                  type="button"
                  class={cn(railRow(false), "mt-1")}
                  data-action="view-all-providers"
                  onClick={() => setBrowsing(true)}
                >
                  <svg
                    class="size-3.5 shrink-0"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M8 3.5v9M3.5 8h9" />
                  </svg>
                  <span class="min-w-0 flex-1 truncate">Add provider</span>
                </button>
              </nav>

              <section class="flex min-w-0 flex-col gap-2" data-component="model-list">
                <Show when={current()}>
                  {(provider) => (
                    <div
                      class="flex items-center gap-3 px-1"
                      data-component="provider-detail"
                      data-provider={provider().id}
                    >
                      <div class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-ui font-medium text-fg">{provider().name}</span>
                        <span
                          class={cn("text-label", saved(provider().id)?.problem ? "text-bad" : cn("truncate", muted))}
                          data-part="provider-status"
                        >
                          {status(provider().id)}
                        </span>
                      </div>
                      <Show when={saved(provider().id)?.problem}>
                        {(problem) => (
                          <>
                            <Show when={FIX_LABEL[problem()]}>
                              {(label) => (
                                <Button data-action="reconnect" onClick={() => setDialog(provider())}>
                                  {label()}
                                </Button>
                              )}
                            </Show>
                            <CheckAgain id={provider().id} />
                          </>
                        )}
                      </Show>
                      <DisconnectButton id={provider().id} />
                    </div>
                  )}
                </Show>
                <div class="flex items-center gap-2">
                  <SearchField
                    wrapClass="min-w-0 flex-1"
                    placeholder="Search models"
                    aria-label="Search models"
                    value={query()}
                    onValue={setQuery}
                    data-component="model-search"
                  />
                </div>
                <div class="flex items-center justify-between gap-2 px-1 text-label text-fg2">
                  <span class="tabular-nums">
                    {shownCount()} of {rows().length} in the picker
                  </span>
                  <span class="flex gap-1">
                    <Button
                      variant="ghost"
                      disabled={shownCount() === rows().length}
                      onClick={() =>
                        setHidden(
                          rows().map((r) => r.ref),
                          false,
                        )
                      }
                    >
                      Show all
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={shownCount() === 0}
                      onClick={() =>
                        setHidden(
                          rows().map((r) => r.ref),
                          true,
                        )
                      }
                    >
                      Hide all
                    </Button>
                  </span>
                </div>
                <Show
                  when={rows().length}
                  fallback={
                    <div class="kit-card">
                      <Empty>
                        {query().trim() ? `No models match "${query().trim()}"` : "This provider has no chat models."}
                      </Empty>
                    </div>
                  }
                >
                  <VList
                    class="kit-card"
                    style={{ height: `${Math.min(rows().length * 36, 540)}px` }}
                    data={rows()}
                    itemSize={36}
                  >
                    {(r) => (
                      <div
                        class="flex h-9 cursor-pointer items-center gap-2.5 border-b border-line px-3 outline-none hover:bg-hover focus-visible:bg-hover"
                        role="switch"
                        tabIndex={0}
                        aria-checked={!hidden().has(r.ref)}
                        aria-label={`Show ${r.model.name} in the model picker`}
                        data-model={r.ref}
                        onClick={() => setHidden([r.ref], !hidden().has(r.ref))}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return
                          if (e.key !== "Enter" && e.key !== " ") return
                          e.preventDefault()
                          setHidden([r.ref], !hidden().has(r.ref))
                        }}
                      >
                        <Show when={!current()}>
                          <ProviderIcon id={r.provider.id} width="14" height="14" />
                        </Show>
                        <span class="min-w-0 flex-1 truncate text-ui text-fg" title={r.model.id}>
                          {r.model.name}
                        </span>
                        <Show when={r.model.reasoning}>
                          <span class="shrink-0 text-hint text-fg4">Reasoning</span>
                        </Show>
                        <span class="w-12 shrink-0 text-right text-hint tabular-nums text-fg4">
                          {formatContext(r.model.contextWindow)}
                        </span>
                        <span onClick={(event) => event.stopPropagation()}>
                          <Toggle
                            label={`Show ${r.model.name} in the model picker`}
                            on={!hidden().has(r.ref)}
                            onChange={(on) => setHidden([r.ref], !on)}
                          />
                        </span>
                      </div>
                    )}
                  </VList>
                </Show>
              </section>
            </div>
          </Show>
        </Show>
      </Tabs>

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

function ProviderSkeletons() {
  return <For each={[0, 1, 2, 3]}>{() => <Skeleton class="h-[58px] rounded-row" />}</For>
}

function CheckAgain(props: { id: string }) {
  const [checking, setChecking] = createSignal(false)
  async function run() {
    setChecking(true)
    try {
      await checkProvider(props.id)
    } catch (e) {
      showToastV2({
        title: "Could not check the provider",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      })
    } finally {
      setChecking(false)
    }
  }
  return (
    <Button variant="ghost" data-action="check-again" busy={checking()} onClick={() => void run()}>
      {checking() ? "Checking" : "Check again"}
    </Button>
  )
}

function DisconnectButton(props: { id: string }) {
  const [removing, setRemoving] = createSignal(false)
  const [sure, setSure] = createSignal(false)
  async function remove() {
    setRemoving(true)
    try {
      await disconnectProvider(props.id)
    } catch (e) {
      showToastV2({
        title: "Could not disconnect",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      })
    } finally {
      setRemoving(false)
      setSure(false)
    }
  }
  return (
    <Button
      variant={sure() ? "danger" : "ghost"}
      data-action="disconnect"
      busy={removing()}
      onBlur={() => setSure(false)}
      onClick={() => (sure() ? void remove() : setSure(true))}
    >
      {sure() ? "Disconnect for good" : "Disconnect"}
    </Button>
  )
}

export function AddProviderDialog(props: {
  open: boolean
  loading: boolean
  providers: readonly CatalogProvider[]
  onClose: () => void
  onPick: (provider: CatalogProvider) => void
}) {
  const [query, setQuery] = createSignal("")
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase()
    return q
      ? props.providers.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      : props.providers
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
        <SearchField
          placeholder="Search providers"
          aria-label="Search providers"
          value={query()}
          ref={(el) => requestAnimationFrame(() => el.focus())}
          onValue={setQuery}
          data-component="provider-search"
        />
      </form>
      <ul class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-component="provider-list">
        <For
          each={shown()}
          fallback={
            <li class={cn("px-2 text-[13px]", muted)}>
              {props.loading ? <Skeleton class="h-8" /> : "No provider matches"}
            </li>
          }
        >
          {(provider) => (
            <li data-provider={provider.id}>
              <button
                type="button"
                class="flex h-10 w-full cursor-pointer items-center gap-3 rounded-row px-2 text-left outline-none hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)]"
                data-action="connect"
                onClick={() => props.onPick(provider)}
              >
                <ProviderIcon id={provider.id} width="16" height="16" />
                <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{provider.name}</span>
                <span class={cn("shrink-0 text-[12px] tabular-nums", muted)}>
                  {provider.models.length} {provider.models.length === 1 ? "model" : "models"}
                </span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Dialog>
  )
}

export function ConnectDialog(props: {
  provider: CatalogProvider | null
  only?: "sign_in" | "api_key"
  onClose: () => void
}) {
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
      props.onClose()
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save the key."
      setError(message)
      showToastV2({ title: "Could not save the key", description: message, variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setError(null)
    props.onClose()
  }
  const methods = () => {
    const provider = props.provider
    const saved = provider ? connectedProviders().find((p) => p.provider === provider.id) : undefined
    const offered = (provider?.connect ?? []).filter(
      (m) => !props.only || (props.only === "api_key") === (m === "api_key"),
    )
    if (!provider || !saved?.problem) return offered
    return offered.filter((m) => (saved.kind === "oauth" ? m !== "api_key" : m === "api_key"))
  }
  const [signingIn, setSigningIn] = createSignal(false)
  const byKey = () => methods().includes("api_key") && !signingIn()

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
          <Button type="submit" form="provider-key-form" variant="primary" busy={busy()} data-action="save-key">
            Save key
          </Button>
        </Show>
      }
    >
      <div class="flex flex-col gap-4">
        <For each={methods()}>
          {(method) =>
            method === "api_key" ? (
              <Show when={!signingIn()}>
                <form id="provider-key-form" class="flex flex-col gap-2" onSubmit={submit} data-method="api_key">
                  <label class="text-[13px] font-medium text-fg" for="provider-key">
                    API key
                  </label>
                  <input
                    id="provider-key"
                    ref={input}
                    {...SECRET_FIELD}
                    name="kiko-provider-secret"
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
              </Show>
            ) : (
              <SignInMethod
                provider={props.provider!.id}
                method={method}
                label={props.provider!.signIn?.method === method ? props.provider!.signIn.label : undefined}
                onRunning={setSigningIn}
                onDone={() => props.onClose()}
              />
            )
          }
        </For>
      </div>
    </Dialog>
  )
}

function SignInMethod(props: {
  provider: string
  method: ConnectMethod
  label?: string | undefined
  onRunning: (running: boolean) => void
  onDone: () => void
}) {
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
  createEffect(() => props.onRunning(running()))
  onCleanup(() => props.onRunning(false))

  return (
    <div class="flex flex-col gap-2" data-method={props.method} data-sign-in={state()?.status ?? "idle"}>
      <div class="flex items-center justify-between gap-2">
        <span class="text-[13px] text-fg">{props.label ?? METHOD_LABEL[props.method]}</span>
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
            <Show when={!s().code && !s().link && !s().prompt}>
              <div
                class={cn("flex items-center gap-2 text-[12px]", muted)}
                data-component="sign-in-waiting"
                role="status"
              >
                <Spinner size={12} />
                Waiting for the provider
              </div>
            </Show>
            <Show when={s().code}>
              {(code) => (
                <div class="flex flex-col gap-1" data-component="device-code">
                  <span class={cn("text-[12px]", muted)}>Enter this code at the provider</span>
                  <span class="select-all font-mono text-msg tracking-widest text-fg">{code().userCode}</span>
                  <a
                    href={code().verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-hint text-[var(--info)]"
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
                  <a
                    href={link().url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link-grow text-[13px] text-[var(--info)]"
                  >
                    Open the sign-in page
                  </a>
                </div>
              )}
            </Show>
            <Show when={s().note}>
              <p class={cn("text-[12px]", muted)} data-component="sign-in-note">
                {s().note}
              </p>
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
                    <label class={cn("text-[12px]", muted)} for="sign-in-answer">
                      {prompt.message}
                    </label>
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
        {(error) => <Notice data-component="sign-in-error">{error()}</Notice>}
      </Show>
    </div>
  )
}
