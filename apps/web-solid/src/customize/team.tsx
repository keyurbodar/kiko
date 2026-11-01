import { type Agent, KIKO, type RecipeApp } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { PlayIcon, TrashIcon } from "@kiko/ui/icons"
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
import { attempt, createQuery, owner } from "../state/runtime"
import { user } from "../state/user"
import { agentMetaLine } from "./agent-meta"
import "./page-ui.css"
import { SkeletonRows } from "./page-ui"

const firstLine = (prompt: string) => prompt.split(/\n/)[0]?.trim() ?? ""
const resolvedModel = (agent: Agent) => {
  const pick = user.agentModel(agent.slug) ?? user.agentModel(KIKO)
  const ref = pick?.model || agent.model
  if (!ref) return undefined
  return pick?.name ?? ref.split("/").slice(1).join("/") ?? ref
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
  const settings = createQuery(() => owner.queries.settings(undefined))
  const memory = () => (settings() === undefined ? undefined : settings()!.capture !== "off")
  const agents = createMemo(() => agentList(user.agents()))
  const recipesFor = (slug: string) => installs().filter((i) => i.agent === slug)
  const appsFor = (slug: string) => {
    const seen = new Map<string, RecipeApp>()
    for (const install of recipesFor(slug))
      for (const app of cards().find((c) => c.slug === install.slug)?.apps ?? []) seen.set(app.slug, app)
    return [...seen.values()]
  }
  const metaFor = (agent: Agent) => agentMetaLine({ model: resolvedModel(agent), memory: memory() })
  return (
    <Show when={user.synced() || user.agents().length} fallback={<SkeletonRows count={4} />}>
      <div class="grid grid-cols-1 gap-3 @min-[640px]/page:grid-cols-2" data-component="team-grid">
        <For each={agents()}>
          {(agent) => (
            <article
              ref={(el) => onCleanup(look(el))}
              class="page-card relative flex min-w-0 flex-col gap-3 rounded-xl bg-editor p-4"
              data-agent={agent.slug}
            >
              <div class="flex min-w-0 items-start gap-3">
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
                <span class="relative z-[1] flex shrink-0 items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Edit ${agent.name}`}
                    data-action="edit-agent"
                    onClick={() => openSettings("models")}
                  >
                    Edit
                  </Button>
                  <Show when={agent.id !== KIKO}>
                    <Button
                      variant="ghost"
                      size="sm"
                      tone="danger"
                      aria-label={`Delete ${agent.name}`}
                      data-action="delete-agent"
                      onClick={() => setDeleting(agent)}
                    >
                      <RemixIcon icon={TrashIcon} size={14} />
                    </Button>
                  </Show>
                </span>
              </div>
              <div class="flex min-w-0 flex-col gap-2 pl-11">
                <Show when={metaFor(agent)}>
                  {(line) => (
                    <p class="type-sm min-w-0 truncate text-secondary" data-component="agent-meta">
                      {line()}
                    </p>
                  )}
                </Show>
                <Show when={appsFor(agent.slug).length || recipesFor(agent.slug).length}>
                  <span class="type-sm flex min-w-0 items-center gap-3 text-tertiary">
                    <Show when={appsFor(agent.slug).length}>
                      <span class="flex min-w-0 items-center gap-1" aria-label="Can use">
                        <For each={appsFor(agent.slug).slice(0, 5)}>{(app) => <AppLogo app={app} size={16} />}</For>
                      </span>
                    </Show>
                    <Show when={recipesFor(agent.slug).length}>
                      <span class="flex shrink-0 items-center gap-1.5">
                        <RemixIcon icon={PlayIcon} size={12} />
                        {recipesFor(agent.slug).length === 1 ? "1 recipe" : `${recipesFor(agent.slug).length} recipes`}
                      </span>
                    </Show>
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
