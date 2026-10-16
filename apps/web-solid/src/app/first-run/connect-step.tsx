import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { loadCatalog, type CatalogProvider } from "../../settings/catalog"
import { AddProviderDialog, ConnectDialog, POPULAR } from "../../settings/models"
import { isJudgeOnly, JUDGE_NOTE } from "../../settings/provider-kinds"
import { move } from "./progress"

/*
 * Connect a model provider. It reuses the settings dialogs, so the key check, the error message and the
 * busy state are the ones Settings has. A connected provider moves first run on by itself (progress.ts).
 */
export function ConnectStep() {
  const [catalog] = createResource(loadCatalog)
  const [dialog, setDialog] = createSignal<CatalogProvider | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const popular = createMemo(() => {
    const all = catalog()?.providers ?? []
    return POPULAR.flatMap(({ id, note }) => {
      const provider = all.find((p) => p.id === id)
      return provider ? [{ provider, note }] : []
    }).concat(all.filter(isJudgeOnly).map((provider) => ({ provider, note: JUDGE_NOTE })))
  })
  return (
    <div class="first-run-step flex w-full flex-col gap-3" data-step="connect">
      <h1 class="text-center text-xl font-medium text-foreground" style={{ "--i": 0 }}>
        Connect a model provider
      </h1>
      <p class="mb-2 text-center text-sm text-muted-foreground" style={{ "--i": 1 }}>
        Kiko runs on your own key. It stays on your server and never reaches this browser.
      </p>
      <div class="flex flex-col gap-2" data-component="first-run-providers" style={{ "--i": 2 }}>
        <Show
          when={!catalog.loading}
          fallback={<For each={POPULAR}>{() => <div class="first-run-skeleton h-[58px] rounded-lg bg-muted" />}</For>}
        >
          <Show when={catalog.error}>
            <p class="text-center text-sm text-[var(--error)]" role="alert">
              The provider list did not load. Reload to try again.
            </p>
          </Show>
          <For each={popular()}>
            {({ provider, note }) => (
              <button
                type="button"
                class="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2.5 text-left outline-none hover:bg-accent"
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
        </Show>
      </div>
      <div class="mt-1 flex items-center justify-between" style={{ "--i": 3 }}>
        <button type="button" class="cursor-pointer text-sm text-muted-foreground outline-none hover:text-foreground" data-action="view-all-providers" onClick={() => setBrowsing(true)}>
          All providers
        </button>
        <button type="button" class="cursor-pointer text-sm text-muted-foreground outline-none hover:text-foreground" data-action="skip-first-run" onClick={() => move("skip")}>
          Skip for now
        </button>
      </div>
      <AddProviderDialog
        open={browsing()}
        loading={catalog.loading}
        providers={catalog()?.providers ?? []}
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
