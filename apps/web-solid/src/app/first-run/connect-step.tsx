import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { loadCatalog, type CatalogProvider } from "../../settings/catalog"
import { AddProviderDialog, ConnectDialog } from "../../settings/models"
import { CHOICE_ROWS, type ConnectVia, type FirstRunChoice, firstRunChoices } from "./choices"
import { move } from "./progress"

/*
 * Connect a model provider. It reuses the settings dialogs, so the key check, the error message and the
 * busy state are the ones Settings has. A connected provider moves first run on by itself (progress.ts).
 */
export function ConnectStep() {
  const [catalog] = createResource(loadCatalog)
  const [dialog, setDialog] = createSignal<{ provider: CatalogProvider; only?: ConnectVia } | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const choices = createMemo(() => firstRunChoices(catalog()?.providers ?? []))
  const group = (via: ConnectVia) => choices().filter((c) => c.via === via)
  return (
    <div class="welcome-step flex w-full flex-col gap-3" data-step="connect">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Connect a model provider
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Sign in with a plan you already pay for, or use an API key. Either stays on your server and never reaches this browser.
      </p>
      <div class="flex flex-col gap-2" data-component="first-run-providers" style={{ "--i": 2 }}>
        <Show
          when={!catalog.loading}
          fallback={<For each={Array.from({ length: CHOICE_ROWS })}>{() => <div class="first-run-skeleton h-[58px] rounded-lg bg-muted" />}</For>}
        >
          <Show when={catalog.error}>
            <p class="welcome-error" role="alert">
              The provider list did not load. Reload to try again.
            </p>
          </Show>
          <ChoiceGroup label="Use a plan you already pay for" choices={group("sign_in")} onPick={(c) => setDialog({ provider: c.provider, only: c.via })} />
          <ChoiceGroup label="Or use an API key" choices={group("api_key")} onPick={(c) => setDialog({ provider: c.provider, only: c.via })} />
        </Show>
      </div>
      <div class="mt-1 flex items-center justify-between" style={{ "--i": 3 }}>
        <button type="button" class="cursor-pointer text-sm text-muted-foreground hover:text-foreground" data-action="view-all-providers" onClick={() => setBrowsing(true)}>
          All providers
        </button>
        <button type="button" class="cursor-pointer text-sm text-muted-foreground hover:text-foreground" data-action="skip-first-run" onClick={() => move("skip")}>
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
          setDialog({ provider })
        }}
      />
      <ConnectDialog provider={dialog()?.provider ?? null} {...(dialog()?.only ? { only: dialog()!.only } : {})} onClose={() => setDialog(null)} />
    </div>
  )
}

function ChoiceGroup(props: { label: string; choices: FirstRunChoice[]; onPick: (choice: FirstRunChoice) => void }) {
  return (
    <Show when={props.choices.length > 0}>
      <div class="flex flex-col gap-2" data-component="first-run-group">
        <span class="px-1 pt-1 text-xs font-medium text-muted-foreground">{props.label}</span>
        <For each={props.choices}>
          {(choice) => (
            <button
              type="button"
              class="flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-border bg-surface px-3.5 py-2.5 text-left hover:border-input"
              data-provider={choice.provider.id}
              data-via={choice.via}
              data-action="connect"
              onClick={() => props.onPick(choice)}
            >
              <ProviderIcon id={choice.provider.id} width="16" height="16" />
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-md font-medium text-foreground">{choice.title}</span>
                <span class="truncate text-sm text-muted-foreground">{choice.note}</span>
              </span>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
