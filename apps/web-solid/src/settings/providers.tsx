import { For, Show, createMemo, createResource, createSignal, onCleanup, type JSX } from "solid-js"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { loadCatalog, type CatalogProvider, type ConnectMethod } from "./catalog"
import { connectedProviders, refreshConnected } from "./connected"
import { connectProvider, disconnectProvider } from "./credentials"
import { startSignIn, type SignIn, type SignInHandle } from "./provider-login"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "api key",
  device_code: "device code sign-in",
  paste_code: "browser sign-in",
}

/*
 * The provider list, generated from the catalog asset. Each row names the
 * provider, the methods the catalog lists for it, and the last four characters
 * of a saved key. A sign-in method runs the provider's own flow on the server
 * (provider-login.ts); the server says when a flow is off or not supported.
 */
export function ProviderList() {
  const [catalog] = createResource(loadCatalog)
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const saved = (id: string) => connectedProviders().find((p) => p.provider === id)
  const [removing, setRemoving] = createSignal<string | null>(null)
  const [query, setQuery] = createSignal("")
  // Connected providers first, then the rest in catalog order. A search narrows both.
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase()
    const all = catalog()?.providers ?? []
    const hits = q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : all
    const on = hits.filter((p) => saved(p.id))
    return [...on, ...hits.filter((p) => !saved(p.id))]
  })
  // Enter on the search connects the first hit, so the common case is type, enter, paste the key.
  const connectFirst = (event: SubmitEvent) => {
    event.preventDefault()
    const first = shown().find((p) => !saved(p.id))
    if (first) setDialog(first)
  }

  async function remove(id: string) {
    setRemoving(id)
    try {
      await disconnectProvider(id)
    } finally {
      setRemoving(null)
      await refreshConnected()
    }
  }

  const connected = () => shown().filter((p) => saved(p.id))
  const others = () => shown().filter((p) => !saved(p.id))

  const Group = (props: { title: string; hint: string; children: JSX.Element }) => (
    <section class="flex flex-col gap-2">
      <div class="px-1">
        <h2 class="text-sm font-medium text-text">{props.title}</h2>
        <p class="text-xs text-weak">{props.hint}</p>
      </div>
      <ul class="flex flex-col overflow-hidden rounded-2xl bg-[var(--surface-raised)] p-1">{props.children}</ul>
    </section>
  )

  const Row = (props: { provider: CatalogProvider }) => {
    const provider = props.provider
    return (
      <li
        class="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 hover:bg-[var(--nav-hover-bg)]"
        style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 60px" }}
        data-provider={provider.id}
        data-connected={saved(provider.id) ? "true" : undefined}
      >
        <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--input-bg)] text-text">
          <ProviderIcon id={provider.id} width="18" height="18" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[15px] text-text">{provider.name.toLowerCase()}</span>
          <span class="block truncate text-xs text-weak">
            <Show when={saved(provider.id)} fallback={`${provider.connect.map((m) => METHOD_LABEL[m]).join(", ") || "no sign-in method"} · ${provider.models.length} models`}>
              {(info) => (info().kind === "api_key" ? `key ending ${info().last4}` : `connected ${info().last4}`) + ` · ${provider.models.length} models`}
            </Show>
          </span>
        </span>
        <Show
          when={saved(provider.id)}
          fallback={
            <button
              type="button"
              class="h-9 shrink-0 rounded-xl bg-[oklch(from_var(--accent)_l_c_h_/_16%)] px-4 text-sm text-[var(--accent)] outline-none hover:bg-[oklch(from_var(--accent)_l_c_h_/_24%)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              data-action="connect"
              onClick={() => setDialog(provider)}
            >
              connect
            </button>
          }
        >
          <button
            type="button"
            class="h-9 shrink-0 rounded-xl px-3 text-sm text-weak outline-none hover:bg-[var(--nav-hover-bg)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
            data-action="disconnect"
            disabled={removing() === provider.id}
            onClick={() => void remove(provider.id)}
          >
            disconnect
          </button>
        </Show>
      </li>
    )
  }

  return (
    <div class="flex flex-col gap-5" data-component="provider-list">
      <form class="sticky top-0 z-10 -mb-2 flex h-10 items-center gap-2 rounded-full bg-[var(--input-bg)] px-4 text-weak focus-within:ring-2 focus-within:ring-[var(--accent)]" role="search" onSubmit={connectFirst}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.75" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          type="search"
          class="h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-weak"
          placeholder="search providers"
          aria-label="search providers"
          autocomplete="off"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          data-component="provider-search"
        />
      </form>
      <Show when={catalog.error}>
        <p class="p-3 text-sm text-weak">the model catalog did not load. reload to try again.</p>
      </Show>
      <Show when={catalog.loading}>
        <p class="p-3 text-sm text-weak">loading providers</p>
      </Show>
      <Show when={connected().length}>
        <Group title="connected" hint="agents in your chats can use these">
          <For each={connected()}>{(provider) => <Row provider={provider} />}</For>
        </Group>
      </Show>
      <Group title={connected().length ? "more providers" : "available"} hint="connect one to start chatting. keys stay on the server.">
        <For each={others()} fallback={<li class="p-4 text-center text-sm text-weak">{catalog.loading ? "" : "no provider matches"}</li>}>
          {(provider) => <Row provider={provider} />}
        </For>
      </Group>
      <ConnectDialog provider={dialog()} onClose={() => setDialog(null)} />
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
        <ModalV2.Content class="w-[min(420px,94vw)] flex-col gap-3 rounded-[16px] bg-bg p-4 shadow-xl">
          <ModalV2.Title class="text-sm font-medium text-muted" data-component="connect-title">
            connect {props.provider?.name.toLowerCase()}
          </ModalV2.Title>
          <For each={props.provider?.connect ?? []}>
            {(method) =>
              method === "api_key" ? (
                <form class="flex flex-col gap-2" onSubmit={submit} data-method="api_key">
                  <label class="text-xs text-weak" for="provider-key">api key</label>
                  <input
                    id="provider-key"
                    ref={input}
                    type="password"
                    name="kiko-provider-secret"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck={false}
                    autofocus
                    class="h-9 rounded-[10px] bg-[var(--input-bg)] px-3 text-sm text-[var(--tab-text-active)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    data-component="provider-key"
                  />
                  <Show when={error()}>
                    <p class="text-xs text-[var(--danger)]" role="alert" data-component="connect-error">{error()}</p>
                  </Show>
                  <button
                    type="submit"
                    disabled={busy()}
                    class="h-10 rounded-[10px] bg-[var(--accent-fill)] px-3 text-sm text-[var(--on-accent)] disabled:opacity-50"
                    data-action="save-key"
                  >
                    save key
                  </button>
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
        <span class="text-sm text-muted">{METHOD_LABEL[props.method]}</span>
        <Show
          when={running()}
          fallback={
            <button
              type="button"
              class="h-8 rounded-[10px] bg-[var(--btn-bg)] px-3 text-xs text-[var(--tab-text-active)] hover:bg-[var(--btn-bg-hover)]"
              data-action="sign-in"
              onClick={start}
            >
              {state()?.status === "error" ? "try again" : "sign in"}
            </button>
          }
        >
          <button
            type="button"
            class="h-8 rounded-[10px] px-3 text-xs text-muted hover:bg-[var(--tab-bg-active)]"
            data-action="cancel-sign-in"
            onClick={() => {
              handle?.cancel()
              setState(null)
            }}
          >
            cancel
          </button>
        </Show>
      </div>
      <Show when={running() ? state() : null}>
        {(s) => (
          <>
            <Show when={s().code}>
              {(code) => (
                <div class="flex flex-col gap-1 rounded-[10px] bg-[var(--surface-raised)] p-3" data-component="device-code">
                  <span class="text-xs text-weak">enter this code at the provider</span>
                  <span class="select-all font-mono text-lg tracking-widest text-[var(--tab-text-active)]">{code().userCode}</span>
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
                <div class="flex flex-col gap-1 rounded-[10px] bg-[var(--surface-raised)] p-3" data-component="sign-in-link">
                  <Show when={link().instructions}>
                    <span class="text-xs text-weak">{link().instructions!.toLowerCase()}</span>
                  </Show>
                  <a href={link().url} target="_blank" rel="noopener noreferrer" class="text-sm text-[var(--accent)]">
                    open the sign-in page
                  </a>
                </div>
              )}
            </Show>
            <Show when={s().note}>
              <p class="text-xs text-weak" data-component="sign-in-note">{s().note!.toLowerCase()}</p>
            </Show>
            <Show when={s().prompt}>
              {(p) => {
                const prompt = p().prompt
                return prompt.type === "select" ? (
                  <div class="flex flex-col gap-1" data-component="sign-in-select">
                    <span class="text-xs text-weak">{prompt.message.toLowerCase()}</span>
                    <For each={prompt.options}>
                      {(option) => (
                        <button
                          type="button"
                          class="h-8 rounded-[10px] bg-[var(--btn-bg)] px-3 text-left text-xs text-[var(--tab-text-active)] hover:bg-[var(--btn-bg-hover)]"
                          onClick={() => handle?.answer(p().promptId, option.id)}
                        >
                          {option.label.toLowerCase()}
                        </button>
                      )}
                    </For>
                  </div>
                ) : (
                  <form class="flex flex-col gap-2" onSubmit={answer} data-component="sign-in-prompt">
                    <label class="text-xs text-weak" for="sign-in-answer">{prompt.message.toLowerCase()}</label>
                    <input
                      id="sign-in-answer"
                      ref={input}
                      type={prompt.type === "secret" ? "password" : "text"}
                      placeholder={prompt.placeholder}
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck={false}
                      autofocus
                      class="h-9 rounded-[10px] bg-[var(--input-bg)] px-3 text-sm text-[var(--tab-text-active)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    />
                    <button
                      type="submit"
                      class="h-10 rounded-[10px] bg-[var(--accent-fill)] px-3 text-sm text-[var(--on-accent)]"
                      data-action="answer-sign-in"
                    >
                      continue
                    </button>
                  </form>
                )
              }}
            </Show>
          </>
        )}
      </Show>
      <Show when={state()?.status === "error" ? state()?.error : null}>
        {(error) => (
          <p class="text-xs text-[var(--danger)]" role="alert" data-component="sign-in-error">{error().toLowerCase()}</p>
        )}
      </Show>
    </div>
  )
}
