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
import { groupMembers, groupTitle, togglePick } from "./bot-picker-model"

const NEW_AGENT = "new-agent"
/** What kiko's new agent flow starts from. The human types the purpose after it. */
const NEW_AGENT_START = "Make me a new agent that "

/*
 * The new chat picker (kat's palette look). A row, clicked or entered, always opens that agent's
 * one chat. The circle, or Space, picks agents for a group, which Kiko leads, so Kiko has no
 * circle. The list and the footer keep their size, so the dialog never moves. Lazy: loaded on first use.
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
    const roomId = useApp.user()?.createChat(groupTitle(names(ids)), ids)
    if (roomId) go(roomId)
  }
  const names = (ids: readonly string[]) => ids.map((id) => agents().find((a) => a.id === id)?.name ?? id)

  const pick = (id: string) => setPicked((list) => togglePick(list, id))

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
    } else if (event.key === " " && query() === "" && highlight() !== "" && highlight() !== NEW_AGENT && highlight() !== KIKO) {
      event.preventDefault()
      pick(highlight())
    }
  }

  return (
    <Dialog open onClose={closeBotPicker} title="New chat" size="md" data-component="bot-picker">
      <Cmdk label="Pick an agent" loop value={highlight()} onValueChange={setHighlight} onKeyDown={keys}>
        <Cmdk.Input class="palette-input" placeholder="Search agents" autofocus onValueChange={setQuery} />
        <Cmdk.List class="palette-list h-[min(320px,50dvh)]">
          <Cmdk.Empty class="palette-empty">No agents match</Cmdk.Empty>
          <For each={agents()}>
            {(agent) => {
              const on = () => picked().includes(agent.id)
              return (
                <Cmdk.Item class="palette-row" value={agent.id} keywords={[agent.name, agent.slug]} onSelect={() => direct(agent)}>
                  <IdentityAvatar seed={agent.slug} size={22} />
                  <span class="palette-label">{agent.name}</span>
                  <Show when={agent.id !== KIKO} fallback={<span class="text-sm text-muted-foreground">Leads every group</span>}>
                    <span class="text-sm text-muted-foreground">@{agent.slug}</span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on()}
                      aria-label={`Pick ${agent.name} for a group`}
                      class="-m-1.5 grid size-7 shrink-0 place-items-center rounded-full hover:bg-accent-strong"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        pick(agent.id)
                      }}
                    >
                      <span
                        class={`grid size-4 place-items-center rounded-full border ${on() ? "border-transparent bg-primary text-primary-foreground" : "border-[color-mix(in_oklab,var(--foreground)_30%,transparent)] text-transparent"}`}
                      >
                        <svg class="size-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M3.5 8.5l3 3 6-7" />
                        </svg>
                      </span>
                    </button>
                  </Show>
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
      <div class="flex h-11 items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
        <span class="min-w-0 truncate">{members().length ? names(members()).join(", ") : "Pick agents with Space to start a group"}</span>
        <Button variant="primary" disabled={members().length < 2} onClick={group}>
          Start group
        </Button>
      </div>
    </Dialog>
  )
}
