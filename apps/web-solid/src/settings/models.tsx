import { For, Show, createMemo, createResource, createSignal, onCleanup, untrack } from "solid-js"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { formatContext, loadCatalog, modelRef, type CatalogProvider, type ConnectMethod } from "./catalog"
import { chatModel, setChatModel } from "./chat-model"
import { connectedProviders, refreshConnected } from "./connected"
import { connectProvider, disconnectProvider } from "./credentials"
import { startSignIn, type SignIn, type SignInHandle } from "./provider-login"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "api key",
  device_code: "device code sign-in",
  paste_code: "browser sign-in",
}

/** Models listed under a provider before "show all". A provider can carry hundreds. */
const PREVIEW_MODELS = 6

/*
 * Settings, models: providers and models are one system. Connected providers come first, each
 * with its models under it; the default model for new chats carries a dot, and one click on any
 * model makes it the default. Below them, a search and a compact list of the providers that are
 * not connected yet, each one click from its connect dialog.
 */
export function ModelsPage() {
  const [catalog] = createResource(loadCatalog)
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const saved = (id: string) => connectedProviders().find((p) => p.provider === id)
  const [query, setQuery] = createSignal("")
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

  return (
    <div class="flex flex-col gap-6" data-component="models-page">
      <Show when={catalog.error}>
        <p class="px-1 text-sm text-weak">the model catalog did not load. reload to try again.</p>
      </Show>
      <For each={connected()}>{(provider) => <ConnectedProvider provider={provider} info={saved(provider.id)!} />}</For>
      <section class="flex flex-col gap-2" data-component="provider-add">
        <h2 class="px-1 text-xs text-weak">{connected().length ? "add a provider" : "connect a provider to start chatting. keys stay on the server."}</h2>
        <form class="flex h-9 items-center gap-2 rounded-full bg-[var(--input-bg)] px-3.5 text-weak focus-within:ring-2 focus-within:ring-[var(--accent)]" role="search" onSubmit={connectFirst}>
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
        <ul class="flex flex-col" data-component="provider-list">
          <For each={available()} fallback={<li class="px-3 py-2 text-sm text-weak">{catalog.loading ? "loading providers" : "no provider matches"}</li>}>
            {(provider) => (
              <li style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 40px" }} data-provider={provider.id}>
                <button
                  type="button"
                  class="group flex h-10 w-full items-center gap-3 rounded-[10px] px-2 text-left outline-none hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  data-action="connect"
                  onClick={() => setDialog(provider)}
                >
                  <span class="grid size-6 shrink-0 place-items-center text-muted">
                    <ProviderIcon id={provider.id} width="16" height="16" />
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm text-text">{provider.name.toLowerCase()}</span>
                  <span class="shrink-0 text-xs text-weak group-hover:hidden">{provider.models.length} models</span>
                  <span class="hidden shrink-0 text-xs text-[var(--accent)] group-hover:inline">connect</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
      <ConnectDialog provider={dialog()} onClose={() => setDialog(null)} />
    </div>
  )
}

/** One connected provider: its name and key, and its models with the default marked. */
function ConnectedProvider(props: { provider: CatalogProvider; info: { kind: string; last4: string } }) {
  const [removing, setRemoving] = createSignal(false)
  const [all, setAll] = createSignal(false)
  const current = () => chatModel(null)
  // The default as the page opened goes first, so it is always in the short list. Picking one
  // later does not reorder the rows under the pointer.
  const first = untrack(current)
  const models = createMemo(() => {
    const list = [...props.provider.models]
    const at = list.findIndex((m) => modelRef(props.provider.id, m.id) === first)
    if (at > 0) list.unshift(...list.splice(at, 1))
    return list
  })
  const shown = () => (all() ? models() : models().slice(0, PREVIEW_MODELS))
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
    <section class="flex flex-col gap-1" data-provider={props.provider.id} data-connected="true">
      <header class="flex h-9 items-center gap-2.5 px-2">
        <span class="grid size-6 shrink-0 place-items-center text-text">
          <ProviderIcon id={props.provider.id} width="16" height="16" />
        </span>
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
          {props.provider.name.toLowerCase()}
          <span class="ml-2 text-xs font-normal text-weak">
            {props.info.kind === "api_key" ? `key ending ${props.info.last4}` : "signed in"}
          </span>
        </span>
        <button
          type="button"
          class="h-7 shrink-0 rounded-[8px] px-2 text-xs text-weak outline-none hover:bg-[var(--nav-hover-bg)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
          data-action="disconnect"
          disabled={removing()}
          onClick={() => void remove()}
        >
          disconnect
        </button>
      </header>
      <ul class="flex flex-col rounded-2xl bg-[var(--surface-raised)] p-1" role="listbox" aria-label={`${props.provider.name.toLowerCase()} models`}>
        <For each={shown()}>
          {(model) => {
            const ref = modelRef(props.provider.id, model.id)
            const isDefault = () => current() === ref
            return (
              <li
                role="option"
                aria-selected={isDefault()}
                tabindex="0"
                class="flex h-10 cursor-default items-center gap-3 rounded-[12px] px-3 outline-none hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                data-model={ref}
                onClick={() => setChatModel(null, ref)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setChatModel(null, ref)
                  }
                }}
              >
                <span class="grid size-4 shrink-0 place-items-center" aria-hidden="true">
                  <span class={isDefault() ? "size-2 rounded-full bg-[var(--accent)]" : "size-2 rounded-full ring-1 ring-[var(--text-faint)]"} />
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-text">{model.name.toLowerCase()}</span>
                <Show when={isDefault()}>
                  <span class="shrink-0 text-xs text-[var(--accent)]" data-component="default-model">default</span>
                </Show>
                <span class="shrink-0 text-xs text-weak">{formatContext(model.contextWindow)}</span>
              </li>
            )
          }}
        </For>
        <Show when={models().length > PREVIEW_MODELS}>
          <li>
            <button
              type="button"
              class="h-9 w-full rounded-[12px] px-3 text-left text-xs text-weak outline-none hover:bg-[var(--nav-hover-bg)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              data-action="show-all-models"
              onClick={() => setAll(!all())}
            >
              {all() ? "show fewer" : `show all ${models().length}`}
            </button>
          </li>
        </Show>
      </ul>
    </section>
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
