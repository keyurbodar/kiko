import { For, Show, createResource, createSignal } from "solid-js"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { loadCatalog, type CatalogProvider, type ConnectMethod } from "./catalog"
import { connectedProviders, refreshConnected } from "./connected"
import { connectProvider, disconnectProvider } from "./credentials"

const METHOD_LABEL: Record<ConnectMethod, string> = {
  api_key: "api key",
  device_code: "device code sign-in",
  paste_code: "browser sign-in",
}

/*
 * The provider list, generated from the catalog asset. Each row names the
 * provider, the methods the catalog lists for it, and the last four characters
 * of a saved key. The sign-in methods are P4-04: they are listed but their
 * button is disabled until that task lands.
 */
export function ProviderList() {
  const [catalog] = createResource(loadCatalog)
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const saved = (id: string) => connectedProviders().find((p) => p.provider === id)
  const [removing, setRemoving] = createSignal<string | null>(null)

  async function remove(id: string) {
    setRemoving(id)
    try {
      await disconnectProvider(id)
    } finally {
      setRemoving(null)
      await refreshConnected()
    }
  }

  return (
    <div class="flex flex-col gap-1" data-component="provider-list">
      <Show when={catalog.error}>
        <p class="p-3 text-sm text-weak">the model catalog did not load. reload to try again.</p>
      </Show>
      <Show when={catalog.loading}>
        <p class="p-3 text-sm text-weak">loading providers</p>
      </Show>
      <ul class="flex flex-col">
        <For each={catalog()?.providers}>
          {(provider) => (
            <li
              class="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 hover:bg-[var(--tab-bg-hover)]"
              style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 52px" }}
              data-provider={provider.id}
              data-connected={saved(provider.id) ? "true" : undefined}
            >
              <span class="min-w-0">
                <span class="block truncate text-sm text-[var(--tab-text-active)]">{provider.name.toLowerCase()}</span>
                <span class="block truncate text-xs text-weak">
                  {provider.connect.map((m) => METHOD_LABEL[m]).join(", ") || "no sign-in method"} · {provider.models.length} models
                </span>
              </span>
              <span class="flex shrink-0 items-center gap-2">
                <Show when={saved(provider.id)}>
                  {(info) => (
                    <>
                      <span class="text-xs text-weak" data-field="last4">
                        {info().kind === "api_key" ? `key ending ${info().last4}` : `connected ${info().last4}`}
                      </span>
                      <button
                        type="button"
                        class="h-7 rounded-[10px] px-2 text-xs text-muted hover:bg-[var(--tab-bg-active)] disabled:opacity-50"
                        data-action="disconnect"
                        disabled={removing() === provider.id}
                        onClick={() => void remove(provider.id)}
                      >
                        disconnect
                      </button>
                    </>
                  )}
                </Show>
                <Show when={!saved(provider.id)}>
                  <button
                    type="button"
                    class="h-7 rounded-[10px] bg-[var(--tab-bg)] px-3 text-xs text-[var(--tab-text-active)] hover:bg-[var(--tab-bg-active)]"
                    data-action="connect"
                    onClick={() => setDialog(provider)}
                  >
                    connect
                  </button>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>
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
                    class="h-9 rounded-[10px] bg-[var(--tab-bg)] px-3 text-sm text-[var(--tab-text-active)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    data-component="provider-key"
                  />
                  <Show when={error()}>
                    <p class="text-xs text-[var(--accent)]" role="alert" data-component="connect-error">{error()}</p>
                  </Show>
                  <button
                    type="submit"
                    disabled={busy()}
                    class="h-9 rounded-[10px] bg-[var(--accent)] px-3 text-sm text-white disabled:opacity-50"
                    data-action="save-key"
                  >
                    save key
                  </button>
                </form>
              ) : (
                <div class="flex items-center justify-between gap-2" data-method={method}>
                  <span class="text-sm text-muted">{METHOD_LABEL[method]}</span>
                  <button
                    type="button"
                    disabled
                    title="sign-in is not built yet"
                    class="h-8 rounded-[10px] bg-[var(--tab-bg)] px-3 text-xs text-weak opacity-50"
                    data-action="sign-in"
                  >
                    sign in
                  </button>
                </div>
              )
            }
          </For>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
