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
    "flex h-sidebar-row-tall w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-primary outline-none transition-colors duration-(--duration-fast) data-[selected=true]:bg-quaternary"
  return (
    <Dialog
      open
      onClose={closeBotPicker}
      title="New chat"
      size="md"
      class="w-[min(480px,calc(100vw-32px))] rounded-3xl"
      bodyClass="px-0 pb-0"
      data-component="bot-picker"
    >
      <Cmdk label="Pick an agent" loop value={highlight()} onValueChange={setHighlight} onKeyDown={keys}>
        <div class="mx-4 mb-2 flex h-control-xl items-center gap-2 rounded-lg bg-input-field px-2.5 shadow-(--hairline)">
          <RemixIcon icon={SearchIcon} size={14} class="shrink-0 icon-tertiary" />
          <Cmdk.Input
            class="h-full min-w-0 flex-1 border-0 bg-transparent type-base text-primary outline-none placeholder:text-quaternary"
            placeholder="Who do you want to talk to?"
            autofocus
            onValueChange={setQuery}
          />
        </div>
        <Cmdk.List class="max-h-[min(360px,50dvh)] overflow-y-auto px-2.5 pb-1.5">
          <Cmdk.Empty class="grid h-sidebar-row-tall place-items-center type-base text-tertiary">
            No agents match
          </Cmdk.Empty>
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
                  <IdentityAvatar seed={agent.slug} size={28} />
                  <span class="flex min-w-0 flex-1 flex-col items-start">
                    <span class="max-w-full truncate type-base">{agent.name}</span>
                    <span class="max-w-full truncate type-sm text-tertiary">
                      {agent.id === KIKO ? "Leads every group" : `@${agent.slug}`}
                    </span>
                  </span>
                  <span class="grid w-6 shrink-0 place-items-center">
                    <span
                      role="checkbox"
                      aria-checked={on()}
                      aria-label={`Pick ${agent.name}`}
                      data-check={on() ? "on" : "off"}
                      class={`grid size-3.5 place-items-center rounded-sm border ${on() ? "border-transparent bg-neutral text-invert" : "border-primary text-transparent"}`}
                    >
                      <RemixIcon icon={CheckIcon} size={12} />
                    </span>
                  </span>
                </Cmdk.Item>
              )
            }}
          </For>
          <Cmdk.Item class={rowClass} value={NEW_AGENT} forceMount onSelect={newAgent}>
            <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-tertiary icon-secondary">
              <RemixIcon icon={PlusIcon} size={14} />
            </span>
            <span class="type-base">New agent</span>
          </Cmdk.Item>
        </Cmdk.List>
      </Cmdk>
      <div class="flex h-12 items-center gap-3 border-t border-tertiary px-4">
        <Show
          when={grouping() && picked().length > 1}
          fallback={<span class="min-w-0 flex-1 truncate type-sm text-quaternary">Pick two or more for a group</span>}
        >
          <input
            class={`${fieldClass} min-w-0 flex-1`}
            aria-label="Group name"
            placeholder={defaultTitle() || "Group name"}
            value={title()}
            maxLength={200}
            onInput={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && start()}
          />
        </Show>
        <button
          type="button"
          data-action="start-chat"
          class="h-control-lg shrink-0 cursor-pointer overflow-hidden rounded-base bg-neutral px-2.5 type-base font-medium whitespace-nowrap text-invert transition-[background-color,transform] duration-(--duration-instant) hover:bg-neutral-hover active:scale-(--press-scale) disabled:opacity-(--opacity-disabled)"
          disabled={!grouping() && !highlighted() && highlight() !== NEW_AGENT}
          onClick={start}
        >
          <For each={[label()]}>{(text) => <span data-slide={moved() ? "" : undefined}>{text}</span>}</For>
        </button>
      </div>
    </Dialog>
  )
}
