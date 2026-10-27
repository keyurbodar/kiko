import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { For, Show, createMemo, createSignal } from "solid-js"
import { createQuery } from "../../state/runtime"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, ChevronRightIcon } from "@kiko/ui/icons"
import { catalogQuery, type CatalogProvider } from "../../settings/catalog"
import { connectedProviders } from "../../settings/connected"
import { AddProviderDialog, ConnectDialog } from "../../settings/models"
import { modelProviders } from "../../settings/provider-kinds"
import { CHOICE_ROWS, type ConnectVia, type FirstRunChoice, firstRunChoices } from "./choices"
import { move, working } from "./progress"
import { signOut } from "../session"
import { errorText, primary, secondary } from "./controls"

export function ConnectStep() {
  const catalog = createQuery(catalogQuery)
  const refetch = catalog.refetch
  const providers = () => (catalog.error ? [] : (catalog()?.providers ?? []))
  const [dialog, setDialog] = createSignal<{ provider: CatalogProvider; only?: ConnectVia } | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const choices = createMemo(() => firstRunChoices(providers()))
  const linked = createMemo(() => new Set(modelProviders(connectedProviders()).map((p) => p.provider)))
  const group = (via: ConnectVia) => choices().filter((c) => c.via === via)
  const others = createMemo(() =>
    providers().filter((p) => linked().has(p.id) && !choices().some((c) => c.provider.id === p.id)),
  )
  const ready = () => linked().size > 0

  return (
    <div class="welcome-step" data-step="connect">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Where should they think?
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Use a plan you already pay for, or an API key. Either stays on your server.
      </p>
      <div class="ob-body" data-component="first-run-providers" style={{ "--i": 2 }}>
        <Show
          when={!catalog.loading}
          fallback={
            <For each={Array.from({ length: CHOICE_ROWS })}>{() => <div class="first-run-skeleton ob-skeleton" />}</For>
          }
        >
          <Show when={catalog.error}>
            <p class={errorText} role="alert">
              The provider list did not load.{" "}
              <button type="button" class="ob-linkish" onClick={() => void refetch()}>
                Try again
              </button>
            </p>
          </Show>
          <ChoiceGroup
            label="Use a plan you already pay for"
            choices={group("sign_in")}
            linked={linked()}
            onPick={(c) => setDialog({ provider: c.provider, only: c.via })}
          />
          <ChoiceGroup
            label="Or an API key"
            choices={group("api_key")}
            linked={linked()}
            onPick={(c) => setDialog({ provider: c.provider, only: c.via })}
          />
          <ChoiceGroup
            label="Also connected"
            choices={others().map((provider) => ({
              provider,
              via: "api_key" as const,
              title: provider.name,
              note: "Connected from More providers.",
            }))}
            linked={linked()}
            onPick={(c) => setDialog({ provider: c.provider })}
          />
          <button type="button" class="ob-more" data-action="view-all-providers" onClick={() => setBrowsing(true)}>
            More providers
            <RemixIcon icon={ChevronRightIcon} size={16} />
          </button>
        </Show>
      </div>
      <div class="ob-cta" style={{ "--i": 3 }}>
        <Show
          when={ready()}
          fallback={
            <button type="button" class={secondary} data-action="skip-first-run" onClick={() => move("skip")}>
              Skip for now
            </button>
          }
        >
          <button type="button" class={primary} data-cta data-action="first-run-continue" onClick={() => move("next")}>
            Continue
          </button>
        </Show>
        <button
          type="button"
          class="ob-textbtn ob-signout"
          data-action="sign-out"
          disabled={working()}
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
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
      <ConnectDialog
        provider={dialog()?.provider ?? null}
        {...(dialog()?.only ? { only: dialog()!.only } : {})}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}

function ChoiceGroup(props: {
  label: string
  choices: FirstRunChoice[]
  linked: ReadonlySet<string>
  onPick: (choice: FirstRunChoice) => void
}) {
  return (
    <Show when={props.choices.length > 0}>
      <div class="ob-group" data-component="first-run-group">
        <span class="ob-label">{props.label}</span>
        <For each={props.choices}>
          {(choice) => (
            <button
              type="button"
              class="ob-card"
              data-provider={choice.provider.id}
              data-via={choice.via}
              data-action="connect"
              data-connected={props.linked.has(choice.provider.id) ? "" : undefined}
              onClick={() => props.onPick(choice)}
            >
              <span class="ob-logo">
                <ProviderIcon id={choice.provider.id} width="18" height="18" />
              </span>
              <span class="ob-card-text">
                <span class="ob-card-title">{choice.title}</span>
                <span class="ob-card-note">{choice.note}</span>
              </span>
              <Show when={props.linked.has(choice.provider.id)}>
                <span class="welcome-connected">
                  <RemixIcon icon={CheckIcon} size={16} />
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
