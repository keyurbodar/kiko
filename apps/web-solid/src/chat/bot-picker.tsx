import { useNavigate } from "@solidjs/router"
import { type Agent, KIKO } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, PlusIcon } from "@kiko/ui/icons"
import { Command as Cmdk } from "cmdk-solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import "../palette/palette.css"
import { agentList } from "../lib/chats"
import { Dialog } from "../lib/dialog"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { Button, fieldClass } from "../settings/kit"
import { openNewAgent } from "../newagent/state"
import { closeBotPicker } from "./bot-picker-state"
import { groupTitle, roomFor, togglePick } from "./bot-picker-model"

const NEW_AGENT = "new-agent"

/*
 * The new chat picker (kat's palette look). With nothing picked, a row, clicked or entered, opens
 * that agent's one chat at once. The checkbox at a row's end starts a group instead: from then on
 * a row adds or drops that agent, and the footer names the group, which Kiko leads. A chat with
 * the same agents is opened rather than made again. Lazy: loaded on first use.
 */
export default function BotPicker() {
  const navigate = useNavigate()
  const [picked, setPicked] = createSignal<string[]>([])
  const [highlight, setHighlight] = createSignal("")
  const [query, setQuery] = createSignal("")
  const [title, setTitle] = createSignal("")
  const agents = createMemo(() => agentList(useApp.agents()))
  const room = createMemo(() => roomFor(picked()))
  const name = (id: string) => agents().find((a) => a.id === id)?.name ?? id
  const grouping = () => picked().length > 0
  const defaultTitle = () => groupTitle(room().map(name))

  const open = (agentIds: readonly string[], chatTitle: string) => {
    const roomId = useApp.user()?.createChat(chatTitle, agentIds)
    if (!roomId) return
    closeBotPicker()
    navigate(`/chat/${roomId}`)
  }

  const start = () => {
    if (room().length > 1) open(room(), title().trim() || defaultTitle())
  }

  const pick = (id: string) => setPicked((list) => togglePick(list, id))
  const choose = (agent: Agent) => (grouping() ? pick(agent.id) : open([agent.id], agent.name))

  const newAgent = () => {
    closeBotPicker()
    openNewAgent()
  }

  // Mod+Enter opens the pick. Space picks the highlighted row, but only while the search is empty, so a space can still be typed.
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      start()
    } else if (event.key === " " && query() === "" && highlight() !== "" && highlight() !== NEW_AGENT) {
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
                <Cmdk.Item class="palette-row" value={agent.id} data-picked={on() ? "true" : undefined} keywords={[agent.name, agent.slug]} onSelect={() => choose(agent)}>
                  <IdentityAvatar seed={agent.slug} size={22} />
                  <span class="palette-label">{agent.name}</span>
                  <span class="text-sm text-muted-foreground">{agent.id === KIKO ? "Leads every group" : `@${agent.slug}`}</span>
                  <button
                    type="button"
                    role="checkbox"
                    tabindex={-1}
                    aria-checked={on()}
                    aria-label={`Pick ${agent.name}`}
                    class="-m-1.5 grid size-7 shrink-0 place-items-center rounded-md"
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
                      <RemixIcon icon={CheckIcon} class="size-3" />
                    </span>
                  </button>
                </Cmdk.Item>
              )
            }}
          </For>
          <Cmdk.Item class="palette-row" value={NEW_AGENT} forceMount onSelect={newAgent}>
            <RemixIcon icon={PlusIcon} size={16} />
            <span class="palette-label">New agent</span>
          </Cmdk.Item>
        </Cmdk.List>
      </Cmdk>
      <div class="flex h-11 items-center gap-3 border-t border-border pt-3">
        <Show when={grouping()} fallback={<span class="min-w-0 truncate text-sm text-muted-foreground">Use the checkboxes to start a group with Kiko</span>}>
          <input
            class={`${fieldClass} min-w-0 flex-1`}
            aria-label="Group name"
            placeholder={defaultTitle() || "Group name"}
            value={title()}
            maxLength={200}
            onInput={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && start()}
          />
          <Button variant="primary" disabled={room().length < 2} onClick={start}>
            Start group
          </Button>
        </Show>
      </div>
    </Dialog>
  )
}
