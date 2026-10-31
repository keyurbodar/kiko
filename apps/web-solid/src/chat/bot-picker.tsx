import { openChat } from "../app/history"
import { KIKO } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, PlusIcon, SearchIcon } from "@kiko/ui/icons"
import { Command as Cmdk } from "cmdk-solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import "./bot-picker.css"
import { agentList } from "../lib/chats"
import { Dialog } from "../lib/dialog"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { user } from "../state/user"
import { fieldClass } from "../settings/kit"
import { openNewAgent } from "../newagent/state"
import { closeBotPicker } from "./bot-picker-state"
import { groupTitle, roomFor, togglePick } from "./bot-picker-model"

const NEW_AGENT = "new-agent"

export default function BotPicker() {
  const [picked, setPicked] = createSignal<string[]>([])
  const [highlight, setHighlight] = createSignal("")
  const [query, setQuery] = createSignal("")
  const [title, setTitle] = createSignal("")
  const [moved, setMoved] = createSignal(false)
  const agents = createMemo(() => agentList(user.agents()))
  const room = createMemo(() => roomFor(picked()))
  const name = (id: string) => agents().find((a) => a.id === id)?.name ?? id
  const grouping = () => picked().length > 0
  const defaultTitle = () => groupTitle(room().map(name))

  const open = (agentIds: readonly string[], chatTitle: string) => {
    const roomId = user.createChat(chatTitle, agentIds)
    if (!roomId) return
    closeBotPicker()
    openChat(roomId)
  }

  const highlighted = () => agents().find((a) => a.id === highlight())

  const start = () => {
    if (grouping()) {
      if (room().length > 0) open(room(), title().trim() || defaultTitle())
    } else if (highlight() === NEW_AGENT) newAgent()
    else if (highlighted()) open([highlight()], name(highlight()))
  }

  const pick = (id: string) => {
    setMoved(true)
    setPicked((list) => togglePick(list, id))
  }
  const label = () => {
    if (picked().length > 1) return "Start group"
    return picked().length === 1 ? `Chat with ${name(picked()[0]!)}` : "Start chat"
  }

  function newAgent() {
    closeBotPicker()
    openNewAgent()
  }

  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      start()
    } else if (event.key === "Enter" && !event.isComposing && highlighted() && !grouping()) {
      event.preventDefault()
      open([highlight()], name(highlight()))
    } else if (event.key === " " && query() === "" && highlight() !== "" && highlight() !== NEW_AGENT) {
      event.preventDefault()
      pick(highlight())
    }
  }

  const rowClass =
    "flex h-chat-row w-full cursor-pointer items-center gap-3 rounded-row px-3 text-fg outline-none transition-colors duration-[var(--dur-hover)] data-[selected=true]:bg-active"
  return (
    <Dialog
      open
      onClose={closeBotPicker}
      title="New chat"
      size="md"
      class="w-[min(480px,calc(100vw-32px))] rounded-sheet"
      bodyClass="px-0 pb-0"
      data-component="bot-picker"
    >
      <Cmdk label="Pick an agent" loop value={highlight()} onValueChange={setHighlight} onKeyDown={keys}>
        <div class="mx-5 mb-2 flex h-control-big items-center gap-3 rounded-pop bg-panel px-4">
          <RemixIcon icon={SearchIcon} size={16} class="shrink-0 text-fg3" />
          <Cmdk.Input
            class="h-full min-w-0 flex-1 border-0 bg-transparent text-row text-fg outline-none placeholder:text-fg4"
            placeholder="Who do you want to talk to?"
            autofocus
            onValueChange={setQuery}
          />
        </div>
        <Cmdk.List class="max-h-[min(360px,50dvh)] overflow-y-auto px-3 pb-2">
          <Cmdk.Empty class="grid h-chat-row place-items-center text-label text-fg3">No agents match</Cmdk.Empty>
          <For each={agents()}>
            {(agent) => {
              const on = () => picked().includes(agent.id)
              return (
                <Cmdk.Item
                  class={rowClass}
                  value={agent.id}
                  data-picked={on() ? "true" : undefined}
                  keywords={[agent.name, agent.slug]}
                  onSelect={() => pick(agent.id)}
                >
                  <IdentityAvatar seed={agent.slug} size={32} />
                  <span class="flex min-w-0 flex-1 flex-col items-start">
                    <span class="max-w-full truncate text-row">{agent.name}</span>
                    <span class="max-w-full truncate text-label text-fg3">
                      {agent.id === KIKO ? "Leads every group" : `@${agent.slug}`}
                    </span>
                  </span>
                  <span class="grid w-6 shrink-0 place-items-center">
                    <span
                      role="checkbox"
                      aria-checked={on()}
                      aria-label={`Pick ${agent.name}`}
                      data-check={on() ? "on" : "off"}
                      class={`grid size-4 place-items-center rounded-check border ${on() ? "border-transparent bg-fg text-bg" : "border-fg4 text-transparent"}`}
                    >
                      <RemixIcon icon={CheckIcon} class="size-3" />
                    </span>
                  </span>
                </Cmdk.Item>
              )
            }}
          </For>
          <Cmdk.Item class={rowClass} value={NEW_AGENT} forceMount onSelect={newAgent}>
            <span class="grid size-mascot shrink-0 place-items-center rounded-tile bg-hover text-fg2">
              <RemixIcon icon={PlusIcon} size={16} />
            </span>
            <span class="text-row">New agent</span>
          </Cmdk.Item>
        </Cmdk.List>
      </Cmdk>
      <div class="flex h-14 items-center gap-3 px-5">
        <Show
          when={grouping() && picked().length > 1}
          fallback={<span class="min-w-0 flex-1 truncate text-hint text-fg4">Pick two or more for a group</span>}
        >
          <input
            class={`${fieldClass} min-w-0 flex-1`}
            aria-label="Group name"
            placeholder={defaultTitle() || "Group name"}
            value={title()}
            maxLength={200}
            onInput={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && !event.isComposing && start()}
          />
        </Show>
        <button
          type="button"
          data-action="start-chat"
          class="h-control shrink-0 cursor-pointer overflow-hidden rounded-control bg-fg px-3 text-label font-medium whitespace-nowrap text-on-fg transition-transform duration-[var(--dur-hover)] active:scale-[0.97] disabled:opacity-(--opacity-disabled)"
          disabled={!grouping() && !highlighted() && highlight() !== NEW_AGENT}
          onClick={start}
        >
          <For each={[label()]}>{(text) => <span data-slide={moved() ? "" : undefined}>{text}</span>}</For>
        </button>
      </div>
    </Dialog>
  )
}
