import { useNavigate } from "@solidjs/router"
import { type Agent, KIKO, sameAgentChat } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { PlusIcon } from "@kiko/ui/icons"
import { Command as Cmdk } from "cmdk-solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { fillComposer } from "../composer/fill"
import "../palette/palette.css"
import { agentList } from "../lib/chats"
import { Dialog } from "../lib/dialog"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { Button } from "../settings/kit"
import { closeBotPicker } from "./bot-picker-state"
import { groupMembers, groupTitle, kikoLocked, togglePick } from "./bot-picker-model"

const NEW_AGENT = "new-agent"
/** What kiko's new agent flow starts from. The human types the purpose after it. */
const NEW_AGENT_START = "Make me a new agent that "

/*
 * The new chat picker (kat's palette look). One agent opens its chat. Two or more make a group,
 * and kiko joins it. Rows come from the stored agents, kiko first. Lazy: loaded on first use.
 */
export default function BotPicker() {
  const navigate = useNavigate()
  const [picked, setPicked] = createSignal<string[]>([])
  const [highlight, setHighlight] = createSignal("")
  const [query, setQuery] = createSignal("")
  const agents = createMemo(() => agentList(useApp.agents()))
  const members = createMemo(() => groupMembers(picked()))

  const go = (roomId: string) => {
    closeBotPicker()
    navigate(`/chat/${roomId}`)
  }

  const direct = (agent: Agent) => {
    const roomId = useApp.openDm(agent)
    if (roomId) go(roomId)
  }

  // A group that already exists, with the same agents in any order, is opened rather than made again.
  const group = () => {
    const ids = members()
    if (ids.length < 2) return
    const existing = sameAgentChat(useApp.user()?.chats() ?? [], ids)
    if (existing) return go(existing.roomId)
    const names = ids.map((id) => agents().find((a) => a.id === id)?.name ?? id)
    const roomId = useApp.user()?.createChat(groupTitle(names), ids)
    if (roomId) go(roomId)
  }

  const pick = (id: string) => setPicked((list) => togglePick(list, id))

  // With nothing picked, a row opens its chat. With something picked, a row joins or leaves the pick.
  const activate = (agent: Agent) => (picked().length === 0 ? direct(agent) : pick(agent.id))

  const newAgent = () => {
    const kiko = useApp.kikoChatId()
    closeBotPicker()
    if (!kiko) return
    fillComposer(kiko, NEW_AGENT_START)
    navigate(`/chat/${kiko}`)
  }

  // Mod+Enter starts the group. Space picks the highlighted row, but only while the search is empty, so a space can still be typed.
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (members().length >= 2) group()
    } else if (event.key === " " && query() === "" && highlight() !== "" && highlight() !== NEW_AGENT) {
      event.preventDefault()
      pick(highlight())
    }
  }

  return (
    <Dialog open onClose={closeBotPicker} title="New chat" size="md" data-component="bot-picker">
      <Cmdk label="Pick an agent" loop value={highlight()} onValueChange={setHighlight} onKeyDown={keys}>
        <Cmdk.Input class="palette-input" placeholder="Search agents" autofocus onValueChange={setQuery} />
        <Cmdk.List class="palette-list">
          <Cmdk.Empty class="palette-empty">No agents match</Cmdk.Empty>
          <For each={agents()}>
            {(agent) => {
              const on = () => members().includes(agent.id)
              const locked = () => agent.id === KIKO && kikoLocked(picked())
              return (
                <Cmdk.Item class="palette-row" value={agent.id} keywords={[agent.name, agent.slug]} onSelect={() => activate(agent)}>
                  <IdentityAvatar seed={agent.slug} size={22} />
                  <span class="palette-label">{agent.name}</span>
                  <span class="text-sm text-muted-foreground">@{agent.slug}</span>
                  <span class="relative grid size-4 shrink-0 place-items-center">
                    <input
                      type="checkbox"
                      class="peer absolute inset-0 m-0 size-4 cursor-pointer opacity-0"
                      aria-label={`Pick ${agent.name}`}
                      checked={on()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!locked()) pick(agent.id);
                      }}
                    />
                    <span class="size-4 rounded-full border border-[color-mix(in_oklab,var(--foreground)_30%,transparent)] peer-checked:border-transparent peer-checked:bg-primary" aria-hidden="true" />
                    <svg class="pointer-events-none absolute size-2.5 text-transparent peer-checked:text-primary-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  </span>
                </Cmdk.Item>
              )
            }}
          </For>
          <Cmdk.Item class="palette-row" value={NEW_AGENT} forceMount onSelect={newAgent}>
            <HugeIcon icon={PlusIcon} size={16} />
            <span class="palette-label">New agent</span>
          </Cmdk.Item>
        </Cmdk.List>
      </Cmdk>
      <Show when={members().length >= 2}>
        <div class="flex justify-end pt-3">
          <Button variant="primary" onClick={group}>
            Start group with {members().length}
          </Button>
        </div>
      </Show>
    </Dialog>
  )
}
