import { useNavigate } from "@solidjs/router"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import { KIKO, type AgentSlug } from "@kiko/protocol"
import { useApp } from "../../lib/store"
import { loadCatalog, modelRef } from "../../settings/catalog"
import { connectedProviders } from "../../settings/connected"
import { modelProviders } from "../../settings/provider-kinds"
import { primary } from "./welcome"
import { move } from "./progress"

const FEW = 5

/** Puts the caret in the Kiko chat's composer once the chat has mounted. Gives up after about two seconds. */
function focusComposer(tries = 40): void {
  const editor = document.querySelector<HTMLElement>(".composer-dock .ProseMirror")
  if (editor) editor.focus()
  else if (tries > 0) setTimeout(() => focusComposer(tries - 1), 50)
}

/*
 * Pick Kiko's model. The list is the connected providers' models, reasoning and large context first, so the
 * first row is a good default. Start chatting sets Kiko's model, then lands in the chat.
 */
export function ModelStep() {
  const navigate = useNavigate()
  const [catalog] = createResource(loadCatalog)
  const [all, setAll] = createSignal(false)
  const [chosen, setChosen] = createSignal<string | null>(null)
  const rows = createMemo(() => {
    const ids = new Set(modelProviders(connectedProviders()).map((p) => p.provider))
    return (catalog()?.providers ?? [])
      .filter((p) => ids.has(p.id))
      .flatMap((provider) => provider.models.map((model) => ({ provider, model, ref: modelRef(provider.id, model.id) })))
      .sort((a, b) => Number(b.model.reasoning) - Number(a.model.reasoning) || b.model.contextWindow - a.model.contextWindow)
  })
  const shown = () => (all() ? rows() : rows().slice(0, FEW))
  const current = () => chosen() ?? rows()[0]?.ref

  const land = () => {
    const row = rows().find((r) => r.ref === current())
    if (row) useApp.setAgentModel(KIKO as AgentSlug, { ref: row.ref, levels: row.model.thinking })
    move("next")
    const kiko = useApp.kikoChatId()
    navigate(kiko ? `/chat/${kiko}` : "/chat", { replace: true })
    focusComposer()
  }

  return (
    <div class="welcome-step flex w-full flex-col gap-3" data-step="model">
      <h1 class="text-center text-xl font-medium text-foreground" style={{ "--i": 0 }}>
        Pick Kiko's model
      </h1>
      <p class="mb-2 text-center text-sm text-muted-foreground" style={{ "--i": 1 }}>
        You can change it any time from the composer.
      </p>
      <div
        class="flex max-h-[min(340px,45dvh)] flex-col gap-1.5 overflow-y-auto"
        role="radiogroup"
        aria-label="Model"
        data-component="first-run-models"
        style={{ "--i": 2 }}
      >
        <Show when={!catalog.loading} fallback={<For each={[0, 1, 2]}>{() => <div class="first-run-skeleton h-[46px] rounded-lg bg-muted" />}</For>}>
          <For each={shown()}>
            {(row) => (
              <div>
                <button
                  type="button"
                  role="radio"
                  aria-checked={current() === row.ref}
                  class="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2.5 text-left hover:bg-accent aria-checked:border-[color-mix(in_oklab,var(--foreground)_40%,transparent)] aria-checked:bg-accent"
                  data-model={row.ref}
                  onClick={() => setChosen(row.ref)}
                >
                  <ProviderIcon id={row.provider.id} width="16" height="16" />
                  <span class="min-w-0 flex-1 truncate text-md font-medium text-foreground">{row.model.name}</span>
                  <span class="shrink-0 text-sm text-muted-foreground">{row.provider.name}</span>
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="mt-1 flex flex-col gap-3" style={{ "--i": 3 }}>
        <button type="button" class={primary} data-action="finish-first-run" onClick={land}>
          Start chatting
        </button>
        <Show when={!all() && rows().length > FEW}>
          <button type="button" class="cursor-pointer self-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setAll(true)}>
            Show all models
          </button>
        </Show>
      </div>
    </div>
  )
}
