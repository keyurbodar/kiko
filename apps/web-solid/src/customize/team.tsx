import { type Agent, KIKO, type RecipeApp } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ModelIcon, PlayIcon } from "@kiko/ui/icons"
import { createMemo, For, Show } from "solid-js"
import { openChat } from "../app/history"
import { agentList } from "../lib/chats"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { AppLogo } from "../recipes/icon"
import { cards, followRecipes, installs } from "../recipes/state"
import { user } from "../state/user"
import { SkeletonRows } from "./page-ui"

const firstLine = (prompt: string) => prompt.split(/\n/)[0]?.trim() ?? ""
const modelName = (model: string) => (model ? (model.split("/").pop() ?? model) : "")

function openAgent(agent: Agent) {
  const chat = agent.id === KIKO ? user.kikoChatId() : undefined
  const own = user.chats().find((c) => c.agents?.length === 1 && c.agents[0] === agent.id)
  const id = chat ?? own?.roomId ?? user.createChat(agent.name, [agent.id])
  if (id) openChat(id)
}

export function TeamTab() {
  followRecipes()
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
              class="group relative flex min-w-0 flex-col gap-4 rounded-[20px] bg-panel p-4 transition-colors duration-[var(--dur-hover)] hover:bg-raise"
              data-agent={agent.slug}
            >
              <button
                type="button"
                class="flex min-w-0 cursor-pointer items-center gap-3.5 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit]"
                aria-label={`Open ${agent.name}`}
                data-action="open-agent"
                onClick={() => openAgent(agent)}
              >
                <IdentityAvatar seed={agent.slug} size={48} />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-[15px] leading-6 font-semibold text-fg">{agent.name}</span>
                  <span class="truncate text-[13px] leading-5 text-fg3">
                    {agent.id === KIKO ? "Lead, plans and routes" : firstLine(agent.prompt) || `@${agent.slug}`}
                  </span>
                </span>
                <span class="flex h-8 shrink-0 items-center rounded-[9px] px-3 text-[13px] font-medium text-fg2 opacity-0 transition-[opacity,background-color] duration-[var(--dur-hover)] group-hover:bg-active group-hover:opacity-100 group-focus-within:opacity-100">
                  Open chat
                </span>
              </button>
              <Show when={appsFor(agent.slug).length}>
                <div class="flex flex-col gap-2">
                  <span class="text-[12.5px] text-fg3">Can use</span>
                  <span class="flex items-center gap-1.5">
                    <For each={appsFor(agent.slug).slice(0, 8)}>{(app) => <AppLogo app={app} size={26} />}</For>
                  </span>
                </div>
              </Show>
              <div class="flex items-center justify-between gap-3 pt-3 text-[13px] text-fg3 shadow-[inset_0_1px_0_var(--line)]">
                <span class="flex min-w-0 items-center gap-2">
                  <RemixIcon icon={ModelIcon} size={15} class="shrink-0" />
                  <span class="truncate">{modelName(agent.model) || "Default model"}</span>
                </span>
                <Show when={recipesFor(agent.slug).length}>
                  <span class="flex shrink-0 items-center gap-1.5">
                    <RemixIcon icon={PlayIcon} size={13} />
                    {recipesFor(agent.slug).length === 1 ? "1 recipe" : `${recipesFor(agent.slug).length} recipes`}
                  </span>
                </Show>
              </div>
            </article>
          )}
        </For>
      </div>
    </Show>
  )
}
