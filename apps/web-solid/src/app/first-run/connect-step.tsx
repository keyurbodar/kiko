import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { For, Show, createMemo, createSignal } from "solid-js"
import { createLive } from "../../sync/changed"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon } from "@kiko/ui/icons"
import { loadCatalog, type CatalogProvider } from "../../settings/catalog"
import { connectedProviders } from "../../settings/connected"
import { AddProviderDialog, ConnectDialog } from "../../settings/models"
import { modelProviders } from "../../settings/provider-kinds"
import { CHOICE_ROWS, type ConnectVia, type FirstRunChoice, firstRunChoices } from "./choices"
import { move } from "./progress"
import { primary } from "./welcome"

export function ConnectStep() {
  const [catalog, { refetch }] = createLive("models", () => true, loadCatalog)
  const providers = () => catalog.error ? [] : (catalog()?.providers ?? [])
  const [dialog, setDialog] = createSignal<{ provider: CatalogProvider; only?: ConnectVia } | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const choices = createMemo(() => firstRunChoices(providers()))
  const linked = createMemo(() => new Set(modelProviders(connectedProviders()).map((p) => p.provider)))
  const group = (via: ConnectVia) => choices().filter((c) => c.via === via)
  const others = createMemo(() => providers().filter((p) => linked().has(p.id) && !choices().some((c) => c.provider.id === p.id)))
  const ready = () => linked().size > 0

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
          fallback={<For each={Array.from({ length: CHOICE_ROWS })}>{() => <div class="first-run-skeleton h-[58px] rounded-lg bg-control" />}</For>}
        >
          <Show when={catalog.error}>
            <p class="text-center text-sm text-[var(--error)]" role="alert">
              The provider list did not load.{" "}
              <button type="button" class="cursor-pointer underline underline-offset-2" onClick={() => void refetch()}>
                Try again
              </button>
            </p>
          </Show>
          <ChoiceGroup label="Use a plan you already pay for" choices={group("sign_in")} linked={linked()} onPick={(c) => setDialog({ provider: c.provider, only: c.via })} />
          <ChoiceGroup label="Or an API key" choices={group("api_key")} linked={linked()} onPick={(c) => setDialog({ provider: c.provider, only: c.via })} />
          <ChoiceGroup label="Also connected" choices={others().map((provider) => ({ provider, via: "api_key" as const, title: provider.name, note: "Connected from More providers." }))} linked={linked()} onPick={(c) => setDialog({ provider: c.provider })} />
        </Show>
      </div>
      <div class="welcome-foot" style={{ "--i": 3 }}>
        <button type="button" data-action="view-all-providers" onClick={() => setBrowsing(true)}>
          More providers
        </button>
        <Show when={!ready()}>
          <button type="button" data-action="skip-first-run" onClick={() => move("skip")}>
            Skip for now
          </button>
        </Show>
      </div>
      <Show when={ready()}>
        <button type="button" class={primary} data-action="first-run-continue" style={{ "--i": 4 }} onClick={() => move("next")}>
          Continue
        </button>
      </Show>
      <AddProviderDialog
        open={browsing()}
        loading={catalog.loading}
        providers={providers()}
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

function ChoiceGroup(props: { label: string; choices: FirstRunChoice[]; linked: ReadonlySet<string>; onPick: (choice: FirstRunChoice) => void }) {
  return (
    <Show when={props.choices.length > 0}>
      <div class="flex flex-col gap-2" data-component="first-run-group">
        <span class="px-1 pt-1 text-xs font-medium text-muted-foreground">{props.label}</span>
        <For each={props.choices}>
          {(choice) => (
            <button
              type="button"
              class="flex cursor-pointer items-center gap-3 rounded-lg bg-control px-3 py-2.5 text-left hover:bg-control-strong"
              data-provider={choice.provider.id}
              data-via={choice.via}
              data-action="connect"
              data-connected={props.linked.has(choice.provider.id) ? "" : undefined}
              onClick={() => props.onPick(choice)}
            >
              <ProviderIcon id={choice.provider.id} width="16" height="16" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm font-medium text-foreground">{choice.title}</span>
                <span class="truncate text-xs text-muted-foreground">{props.linked.has(choice.provider.id) ? "Connected. Select to change it." : choice.note}</span>
              </span>
              <Show when={props.linked.has(choice.provider.id)}>
                <span class="welcome-connected">
                  <RemixIcon icon={CheckIcon} size={13} />
                  Connected
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
