import { useNavigate } from "@solidjs/router"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { KIKO, KIKO_HOME_ROOM, type AgentSlug } from "@kiko/protocol"
import { useApp } from "../../lib/store"
import { loadCatalog, modelRef, type CatalogProvider } from "../../settings/catalog"
import { connectedProviders } from "../../settings/connected"
import { AddProviderDialog, ConnectDialog } from "../../settings/models"
import { modelProviders } from "../../settings/provider-kinds"
import { CHOICE_ROWS, type ConnectVia, type FirstRunChoice, firstRunChoices } from "./choices"
import { move } from "./progress"
import { modelToSave, shownModel } from "./steps"
import { primary } from "./welcome"

const FEW = 5

/** Puts the caret in the Kiko chat's composer once the chat has mounted. Gives up after about two seconds. */
function focusComposer(tries = 40): void {
  const editor = document.querySelector<HTMLElement>(".composer-dock .ProseMirror")
  if (editor) editor.focus()
  else if (tries > 0) setTimeout(() => focusComposer(tries - 1), 50)
}

/*
 * Connect a model provider, and pick the model Kiko thinks with. It reuses the settings dialogs, so the
 * key check, the error message and the busy state are the ones Settings has. A connected provider writes
 * the model line under the list; "Change" opens the same model list the model screen used to show.
 */
export function ConnectStep() {
  const navigate = useNavigate()
  const [catalog, { refetch }] = createResource(loadCatalog)
  const providers = () => catalog.error ? [] : (catalog()?.providers ?? [])
  const [dialog, setDialog] = createSignal<{ provider: CatalogProvider; only?: ConnectVia } | null>(null)
  const [browsing, setBrowsing] = createSignal(false)
  const [picking, setPicking] = createSignal(false)
  const [all, setAll] = createSignal(false)
  const [chosen, setChosen] = createSignal<string | null>(null)
  const choices = createMemo(() => firstRunChoices(providers()))
  const group = (via: ConnectVia) => choices().filter((c) => c.via === via)
  const rows = createMemo(() => {
    const ids = new Set(modelProviders(connectedProviders()).map((p) => p.provider))
    return providers()
      .filter((p) => ids.has(p.id))
      .flatMap((provider) => provider.models.map((model) => ({ provider, model, ref: modelRef(provider.id, model.id) })))
  })
  /** The list to browse: reasoning and large context first. The default below stays the catalog's own first model. */
  const ranked = createMemo(() => [...rows()].sort((a, b) => Number(b.model.reasoning) - Number(a.model.reasoning) || b.model.contextWindow - a.model.contextWindow))
  const shown = () => (all() ? ranked() : ranked().slice(0, FEW))
  const running = () => useApp.agentModel(KIKO)?.model
  /**
   * What Kiko will think with: the model it already runs on when that one is here, else the provider's own
   * default, which is the first model the pi-ai catalog lists for it. Never a name in this file.
   */
  const fallback = () => {
    const refs = rows().map((r) => r.ref)
    const on = running()
    return on && refs.includes(on) ? on : refs[0]
  }
  const current = () => shownModel(chosen(), fallback(), rows().map((r) => r.ref))
  const modelName = () => rows().find((r) => r.ref === current())?.model.name

  const land = () => {
    const row = rows().find((r) => r.ref === modelToSave(current(), running()))
    if (row) useApp.setAgentModel(KIKO as AgentSlug, { ref: row.ref, levels: row.model.thinking })
    move("next")
    navigate(`/chat/${useApp.kikoChatId() ?? KIKO_HOME_ROOM}`, { replace: true })
    focusComposer()
  }

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
          <ChoiceGroup label="Use a plan you already pay for" choices={group("sign_in")} onPick={(c) => setDialog({ provider: c.provider, only: c.via })} />
          <ChoiceGroup label="Or an API key" choices={group("api_key")} onPick={(c) => setDialog({ provider: c.provider, only: c.via })} />
        </Show>
      </div>
      <div class="welcome-foot" style={{ "--i": 3 }}>
        <button type="button" data-action="view-all-providers" onClick={() => setBrowsing(true)}>
          More providers
        </button>
        <button type="button" data-action="skip-first-run" onClick={() => move("skip")}>
          Skip for now
        </button>
      </div>
      <Show when={rows().length > 0}>
        <div class="welcome-model">
          <p>
            Kiko will think with <span class="welcome-model-name">{modelName()}</span>.{" "}
            <button type="button" data-action="change-model" onClick={() => setPicking((open) => !open)}>
              Change
            </button>
          </p>
          <Show when={picking()}>
            <div
              class="flex max-h-[min(220px,32dvh)] flex-col gap-1.5 overflow-y-auto"
              role="radiogroup"
              aria-label="Model"
              data-component="first-run-models"
              ref={(el) =>
                queueMicrotask(() => {
                  // The card scrolls, not the page: bring the list and the button under it into view.
                  const card = el.closest(".welcome-card")
                  if (card) card.scrollTop = card.scrollHeight
                })
              }
            >
              <For each={shown()}>
                {(row) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={current() === row.ref}
                    class="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-control px-3 py-2.5 text-left hover:bg-control-strong aria-checked:bg-accent"
                    data-model={row.ref}
                    onClick={() => {
                      setChosen(row.ref)
                      useApp.setAgentModel(KIKO as AgentSlug, { ref: row.ref, levels: row.model.thinking })
                    }}
                  >
                    <ProviderIcon id={row.provider.id} width="16" height="16" />
                    <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.model.name}</span>
                    <span class="shrink-0 text-xs text-muted-foreground">{row.provider.name}</span>
                  </button>
                )}
              </For>
              <Show when={!all() && rows().length > FEW}>
                <button type="button" class="cursor-pointer self-center py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAll(true)}>
                  Show all models
                </button>
              </Show>
            </div>
          </Show>
          <button type="button" class={primary} data-action="finish-first-run" onClick={land}>
            Start chatting
          </button>
        </div>
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

function ChoiceGroup(props: { label: string; choices: FirstRunChoice[]; onPick: (choice: FirstRunChoice) => void }) {
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
              onClick={() => props.onPick(choice)}
            >
              <ProviderIcon id={choice.provider.id} width="16" height="16" />
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-sm font-medium text-foreground">{choice.title}</span>
                <span class="truncate text-xs text-muted-foreground">{choice.note}</span>
              </span>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
