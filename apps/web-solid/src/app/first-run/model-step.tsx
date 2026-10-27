import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, SearchIcon } from "@kiko/ui/icons"
import { For, Show, createMemo, createSignal } from "solid-js"
import { KIKO, type AgentSlug } from "@kiko/protocol"
import { createQuery } from "../../state/runtime"
import { room } from "../../state/room"
import { user } from "../../state/user"
import { catalogQuery } from "../../settings/catalog"
import { formatContext, formatPrice, modelRef, searchModels } from "../../settings/model-list"
import { connectedProviders } from "../../settings/connected"
import { modelProviders } from "../../settings/provider-kinds"
import type { ModelChoice } from "./choices"
import { errorText, primary } from "./controls"
import { setFinished } from "./progress"

const SKELETONS = 4
const SEARCH_FROM = 8

export function ModelStep() {
  const catalog = createQuery(catalogQuery)
  const refetch = catalog.refetch
  const [query, setQuery] = createSignal("")
  const [chosen, setChosen] = createSignal<string | null>(null)
  const live = createMemo(() => {
    const ids = new Set(modelProviders(connectedProviders()).map((p) => p.provider))
    return (catalog.error ? [] : (catalog()?.providers ?? [])).filter((p) => ids.has(p.id))
  })
  const all = createMemo(() =>
    live().flatMap((provider) =>
      provider.models.map((model): ModelChoice => ({ provider, model, ref: modelRef(provider.id, model.id) })),
    ),
  )
  const running = () => all().find((c) => c.ref === user.agentModel(KIKO)?.model)?.ref
  const current = () => chosen() ?? running()
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
    return live().map((provider) => ({
      label: live().length > 1 ? provider.name : null,
      rows: all().filter((c) => c.provider.id === provider.id),
    }))
  })

  const groups = createMemo(() => sections().filter((g) => g.rows.length > 0))

  const start = () => {
    const pick = all().find((c) => c.ref === current())
    if (pick && pick.ref !== user.agentModel(KIKO)?.model)
      room.setAgentModel(KIKO as AgentSlug, { ref: pick.ref, levels: pick.model.thinking, name: pick.model.name })
    setFinished(true)
  }

  return (
    <div class="welcome-step" data-step="model">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Choose how Kiko thinks.
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Kiko is your main agent. You can switch models any time from the composer.
      </p>
      <Show when={all().length > SEARCH_FROM}>
        <label class="welcome-search" style={{ "--i": 2 }}>
          <RemixIcon icon={SearchIcon} size={16} />
          <input
            type="search"
            placeholder="Search models"
            aria-label="Search models"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
      </Show>
      <div class="ob-body" role="radiogroup" aria-label="Model" data-component="first-run-models" style={{ "--i": 3 }}>
        <Show
          when={!catalog.loading}
          fallback={
            <For each={Array.from({ length: SKELETONS })}>{() => <div class="first-run-skeleton ob-skeleton" />}</For>
          }
        >
          <Show when={catalog.error}>
            <p class={errorText} role="alert">
              The model list did not load.{" "}
              <button type="button" class="ob-linkish" onClick={() => void refetch()}>
                Try again
              </button>
            </p>
          </Show>
          <For each={groups()} fallback={<p class="ob-empty">No models match.</p>}>
            {(group) => (
              <div class="ob-group" data-component="first-run-model-group">
                <Show when={group.label}>{(label) => <span class="ob-label">{label()}</span>}</Show>
                <For each={group.rows}>
                  {(row) => <ModelRow row={row} selected={current() === row.ref} onPick={() => setChosen(row.ref)} />}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="ob-cta" style={{ "--i": 4 }}>
        <button
          type="button"
          class={primary}
          data-cta
          data-action="finish-first-run"
          disabled={!current()}
          onClick={start}
        >
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
      class="ob-card"
      data-model={props.row.ref}
      onClick={props.onPick}
    >
      <span class="ob-logo">
        <ProviderIcon id={props.row.provider.id} width="18" height="18" />
      </span>
      <span class="ob-card-text">
        <span class="ob-card-title">{props.row.model.name}</span>
        <span class="ob-card-note">
          {formatContext(props.row.model.contextWindow)} context, {formatPrice(props.row.model.pricing)}
          {props.row.model.reasoning ? ", reasoning" : ""}
        </span>
      </span>
      <span class="ob-tick" aria-hidden="true">
        <RemixIcon icon={CheckIcon} size={12} />
      </span>
    </button>
  )
}
