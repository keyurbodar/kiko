import { type Agent, KIKO, type RecipeApp } from "@kiko/protocol"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { PlayIcon } from "@kiko/ui/icons"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { openChat } from "../app/history"
import { agentList } from "../lib/chats"
import { Dialog } from "../lib/dialog"
import { showFailure } from "../lib/errors"
import { look } from "../lib/motion"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { AppLogo } from "../recipes/icon"
import { cards, followRecipes, installs } from "../recipes/state"
import { Button } from "../settings/kit"
import { openSettings } from "../settings/open"
import { attempt, owner } from "../state/runtime"
import { user } from "../state/user"
import "./page-ui.css"
import { SkeletonRows } from "./page-ui"

const firstLine = (prompt: string) => prompt.split(/\n/)[0]?.trim() ?? ""
const resolvedModel = (agent: Agent) => {
  const pick = user.agentModel(agent.slug) ?? user.agentModel(KIKO)
  const ref = pick?.model || agent.model
  if (!ref) return undefined
  return { provider: ref.split("/")[0] ?? "", name: pick?.name ?? ref.split("/").slice(1).join("/") ?? ref }
}

function openAgent(agent: Agent) {
  const chat = agent.id === KIKO ? user.kikoChatId() : undefined
  const own = user.chats().find((c) => c.agents?.length === 1 && c.agents[0] === agent.id)
  const id = chat ?? own?.roomId ?? user.createChat(agent.name, [agent.id])
  if (id) openChat(id)
}

function DeleteAgentDialog(props: { agent: Agent | null; onClose: () => void }) {
  const confirm = () => {
    const agent = props.agent
    props.onClose()
    if (agent)
      void attempt(owner.commands.deleteAgent, agent.slug, showFailure, "Kiko could not delete the agent. Try again.")
  }
  return (
    <Dialog
      open={props.agent !== null}
      onClose={props.onClose}
      title={`Delete ${props.agent?.name ?? "this agent"}?`}
      description="It leaves every group, and its own chats, files, routines and memory are removed from this device and the server. Its handle cannot be used again."
      data-component="delete-agent-dialog"
      footer={
        <>
          <Button variant="ghost" data-action="cancel-delete" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="danger" data-action="confirm-delete" onClick={confirm}>
            Delete
          </Button>
        </>
      }
    />
  )
}

export function TeamTab() {
  followRecipes()
  const [deleting, setDeleting] = createSignal<Agent | null>(null)
  const agents = createMemo(() => agentList(user.agents()))
  const recipesFor = (slug: string) => installs().filter((i) => i.agent === slug)
  const appsFor = (slug: string) => {
    const seen = new Map<string, RecipeApp>()
    for (const install of recipesFor(slug))
      for (const app of cards().find((c) => c.slug === install.slug)?.apps ?? []) seen.set(app.slug, app)
    return [...seen.values()]
  }
  return (
    <Show when={user.synced() || user.agents().length} fallback={<SkeletonRows count={4} grid />}>
      <div class="grid grid-cols-1 gap-3 @min-[720px]/page:grid-cols-2" data-component="team-list">
        <For each={agents()}>
          {(agent) => (
            <article
              ref={(el) => onCleanup(look(el))}
              class="group relative flex min-w-0 flex-col gap-3 page-card rounded-xl bg-editor p-3 transition-colors duration-(--duration-fast) hover:bg-quaternary-opaque-elevated"
              data-agent={agent.slug}
            >
              <div class="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit]"
                  aria-label={`Open ${agent.name}`}
                  data-action="open-agent"
                  onClick={() => openAgent(agent)}
                >
                  <IdentityAvatar seed={agent.slug} size={36} />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="type-base truncate text-primary">{agent.name}</span>
                    <span class="type-sm truncate text-tertiary">
                      {agent.id === KIKO ? "Lead, plans and routes" : firstLine(agent.prompt) || `@${agent.slug}`}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  class="type-sm relative z-[1] flex h-control-md shrink-0 cursor-pointer items-center rounded-base px-2 text-secondary transition-colors duration-(--duration-fast) hover:bg-tertiary hover:text-primary"
                  aria-label={`Edit ${agent.name}`}
                  data-action="edit-agent"
                  onClick={() => openSettings("models")}
                >
                  Edit
                </button>
                <Show when={agent.id !== KIKO}>
                  <button
                    type="button"
                    class="type-sm relative z-[1] flex h-control-md shrink-0 cursor-pointer items-center rounded-base px-2 text-secondary transition-colors duration-(--duration-fast) hover:bg-tertiary hover:text-danger"
                    aria-label={`Delete ${agent.name}`}
                    data-action="delete-agent"
                    onClick={() => setDeleting(agent)}
                  >
                    Delete
                  </button>
                </Show>
              </div>
              <Show when={appsFor(agent.slug).length}>
                <div class="flex flex-col gap-2">
                  <span class="type-sm text-tertiary">Can use</span>
                  <span class="flex items-center gap-1.5">
                    <For each={appsFor(agent.slug).slice(0, 8)}>{(app) => <AppLogo app={app} size={20} />}</For>
                  </span>
                </div>
              </Show>
              <div class="flex items-center justify-between gap-3 type-sm pt-3 text-tertiary shadow-[inset_0_1px_0_var(--stroke-tertiary)]">
                <span class="flex min-w-0 items-center gap-2">
                  <Show when={resolvedModel(agent)}>
                    {(model) => (
                      <>
                        <ProviderIcon id={model().provider} width="14" height="14" />
                        <span class="truncate" data-field="model">
                          {model().name}
                        </span>
                      </>
                    )}
                  </Show>
                </span>
                <Show when={recipesFor(agent.slug).length}>
                  <span class="flex shrink-0 items-center gap-1.5">
                    <RemixIcon icon={PlayIcon} size={12} />
                    {recipesFor(agent.slug).length === 1 ? "1 recipe" : `${recipesFor(agent.slug).length} recipes`}
                  </span>
                </Show>
              </div>
            </article>
          )}
        </For>
      </div>
      <DeleteAgentDialog agent={deleting()} onClose={() => setDeleting(null)} />
    </Show>
  )
}
