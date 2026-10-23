import { useNavigate } from "@solidjs/router"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, SearchIcon } from "@kiko/ui/icons"
import { For, Show, createMemo, createSignal } from "solid-js"
import { KIKO, KIKO_HOME_ROOM, type AgentSlug } from "@kiko/protocol"
import { createLive } from "../../sync/changed"
import { useApp } from "../../lib/store"
import { formatContext, formatPrice, loadCatalog, modelRef, searchModels } from "../../settings/catalog"
import { connectedProviders } from "../../settings/connected"
import { modelProviders } from "../../settings/provider-kinds"
import { type ModelChoice, rankModels, startingModel } from "./choices"
import { move, setStep } from "./progress"
import { primary } from "./welcome"

const RECOMMENDED = 4
const SEARCH_FROM = 8

function focusComposer(tries = 40): void {
  const editor = document.querySelector<HTMLElement>(".composer-dock .ProseMirror")
  if (editor) editor.focus()
  else if (tries > 0) setTimeout(() => focusComposer(tries - 1), 50)
}

export function ModelStep() {
  const navigate = useNavigate()
  const [catalog, { refetch }] = createLive("models", () => true, loadCatalog)
  const [query, setQuery] = createSignal("")
  const [chosen, setChosen] = createSignal<string | null>(null)
  const live = createMemo(() => {
    const ids = new Set(modelProviders(connectedProviders()).map((p) => p.provider))
    return (catalog.error ? [] : (catalog()?.providers ?? [])).filter((p) => ids.has(p.id))
  })
  const ranked = createMemo(() =>
    rankModels(
      live().flatMap((provider) =>
        provider.models.map((model) => ({ provider, model, ref: modelRef(provider.id, model.id) })),
      ),
    ),
  )
  const current = () => chosen() ?? startingModel(ranked(), useApp.agentModel(KIKO)?.model)
  const searching = () => query().trim() !== ""
  const sections = createMemo(() => {
    if (searching())
      return [
        {
          label: null,
          rows: searchModels(live(), query()).map(({ provider, model }) => ({
            provider,
            model,
            ref: modelRef(provider.id, model.id),
          })),
        },
      ]
    if (ranked().length <= RECOMMENDED) return [{ label: null, rows: ranked() }]
    const rest = ranked().slice(RECOMMENDED)
    const byProvider = live().map((provider) => ({
      label: live().length > 1 ? provider.name : "More models",
      rows: rest.filter((c) => c.provider.id === provider.id),
    }))
    return [{ label: "Recommended", rows: ranked().slice(0, RECOMMENDED) }, ...byProvider]
  })

  const groups = createMemo(() => sections().filter((g) => g.rows.length > 0))

  const start = () => {
    const pick = ranked().find((c) => c.ref === current())
    if (pick && pick.ref !== useApp.agentModel(KIKO)?.model)
      useApp.setAgentModel(KIKO as AgentSlug, { ref: pick.ref, levels: pick.model.thinking })
    move("next")
    navigate(`/chat/${useApp.kikoChatId() ?? KIKO_HOME_ROOM}`, { replace: true })
    focusComposer()
  }

  return (
    <div class="welcome-step welcome-step-fill flex w-full flex-col gap-3" data-step="model">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Choose Kiko's model
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Kiko is your main agent. You can switch models any time from the composer.
      </p>
      <Show when={ranked().length > SEARCH_FROM}>
        <label class="welcome-search" style={{ "--i": 2 }}>
          <RemixIcon icon={SearchIcon} size={15} />
          <input
            type="search"
            placeholder="Search models"
            aria-label="Search models"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
      </Show>
      <div
        class="welcome-models"
        role="radiogroup"
        aria-label="Model"
        data-component="first-run-models"
        style={{ "--i": 3 }}
      >
        <Show
          when={!catalog.loading}
          fallback={
            <For each={Array.from({ length: RECOMMENDED })}>
              {() => <div class="first-run-skeleton h-[52px] shrink-0 rounded-lg bg-control" />}
            </For>
          }
        >
          <Show when={catalog.error}>
            <p class="text-center text-sm text-[var(--error)]" role="alert">
              The model list did not load.{" "}
              <button type="button" class="cursor-pointer underline underline-offset-2" onClick={() => void refetch()}>
                Try again
              </button>
            </p>
          </Show>
          <For
            each={groups()}
            fallback={<p class="py-6 text-center text-sm text-muted-foreground">No models match.</p>}
          >
            {(group) => (
              <div class="flex flex-col gap-1.5" data-component="first-run-model-group">
                <Show when={group.label}>{(label) => <span class="welcome-group-label">{label()}</span>}</Show>
                <For each={group.rows}>
                  {(row) => <ModelRow row={row} selected={current() === row.ref} onPick={() => setChosen(row.ref)} />}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="welcome-actions" style={{ "--i": 4 }}>
        <button type="button" class="welcome-back" data-action="first-run-back" onClick={() => setStep("connect")}>
          Back
        </button>
        <button type="button" class={primary} data-action="finish-first-run" disabled={!current()} onClick={start}>
          Start chatting
        </button>
      </div>
    </div>
  )
}

function ModelRow(props: { row: ModelChoice; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      class="welcome-option"
      data-model={props.row.ref}
      onClick={props.onPick}
    >
      <ProviderIcon id={props.row.provider.id} width="16" height="16" />
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm font-medium text-foreground">{props.row.model.name}</span>
        <span class="truncate text-xs text-muted-foreground">
          {formatContext(props.row.model.contextWindow)} context · {formatPrice(props.row.model.pricing)}
          {props.row.model.reasoning ? " · Reasoning" : ""}
        </span>
      </span>
      <Show when={props.selected}>
        <RemixIcon icon={CheckIcon} size={16} class="shrink-0 text-foreground" />
      </Show>
    </button>
  )
}
