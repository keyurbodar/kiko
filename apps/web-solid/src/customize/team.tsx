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

const rowAction =
  "type-base flex h-control-md cursor-pointer items-center rounded-base px-2 text-secondary transition-colors duration-(--duration-fast) hover:bg-tertiary hover:text-primary"

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
    <Show when={user.synced() || user.agents().length} fallback={<SkeletonRows count={4} />}>
      <ul class="team-list flex flex-col rounded-xl bg-editor page-card" data-component="team-list">
        <For each={agents()}>
          {(agent) => (
            <li
              ref={(el) => onCleanup(look(el))}
              class="team-row group relative flex h-14 min-w-0 items-center gap-3 px-3"
              data-agent={agent.slug}
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit]"
                aria-label={`Open ${agent.name}`}
                data-action="open-agent"
                onClick={() => openAgent(agent)}
              >
                <IdentityAvatar seed={agent.slug} size={32} />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="type-base truncate text-primary">{agent.name}</span>
                  <span class="type-sm truncate text-tertiary">
                    {agent.id === KIKO ? "Lead, plans and routes" : firstLine(agent.prompt) || `@${agent.slug}`}
                  </span>
                </span>
              </button>
              <span class="type-sm flex shrink-0 items-center gap-4 text-tertiary max-[639px]:hidden">
                <Show when={appsFor(agent.slug).length}>
                  <span class="flex items-center gap-1" aria-label="Can use">
                    <For each={appsFor(agent.slug).slice(0, 5)}>{(app) => <AppLogo app={app} size={16} />}</For>
                  </span>
                </Show>
                <Show when={recipesFor(agent.slug).length}>
                  <span class="flex items-center gap-1.5">
                    <RemixIcon icon={PlayIcon} size={12} />
                    {recipesFor(agent.slug).length === 1 ? "1 recipe" : `${recipesFor(agent.slug).length} recipes`}
                  </span>
                </Show>
                <Show when={resolvedModel(agent)}>
                  {(model) => (
                    <span class="flex min-w-0 items-center gap-1.5">
                      <ProviderIcon id={model().provider} width="14" height="14" />
                      <span class="max-w-40 truncate" data-field="model">
                        {model().name}
                      </span>
                    </span>
                  )}
                </Show>
              </span>
              <span class="team-row-actions relative z-[1] flex shrink-0 items-center gap-px">
                <button
                  type="button"
                  class={rowAction}
                  aria-label={`Edit ${agent.name}`}
                  data-action="edit-agent"
                  onClick={() => openSettings("models")}
                >
                  Edit
                </button>
                <Show when={agent.id !== KIKO}>
                  <button
                    type="button"
                    class={`${rowAction} hover:text-danger`}
                    aria-label={`Delete ${agent.name}`}
                    data-action="delete-agent"
                    onClick={() => setDeleting(agent)}
                  >
                    Delete
                  </button>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>
      <DeleteAgentDialog agent={deleting()} onClose={() => setDeleting(null)} />
    </Show>
  )
}
