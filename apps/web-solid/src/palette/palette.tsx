import { useNavigate } from "@solidjs/router"
import { Command as Cmdk } from "cmdk-solid"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { defaultThinking, THINKING_LABELS, type ThinkingLevel } from "@kiko/protocol"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { answeringMember } from "../settings/agent-model"
import { For, Show, createEffect, createMemo } from "solid-js"
import { displayShortcut } from "../commands/hotkeys"
import { useApp } from "../lib/store"
import { closePalette, paletteMode } from "./state"
import { iconFor, paletteGroups } from "./model"
import "./palette.css"

/*
 * kat's command palette (screenshot 20). cmdk-solid filters, ranks, and moves
 * the highlight; the rows come from the registry under their group's heading,
 * or from the chat list in chat mode. Nothing here animates.
 */
export default function Palette() {
  const navigate = useNavigate()
  const groups = createMemo(() => paletteGroups())
  const chats = createMemo(() => useApp.bots())
  let input: HTMLInputElement | undefined
  // The agent the composer's model chip targets when the draft tags no one: the lead.
  const target = () => answeringMember(useApp.roomMembers(), "")
  const picked = () => useApp.agentModel(target()?.slug ?? "")
  const levels = () => picked()?.thinkingLevels ?? []

  // Focus goes back to where it was, so closing the palette does not strand the person on the page body.
  let before: Element | null = null
  createEffect(() => {
    if (paletteMode()) {
      before ??= document.activeElement
      queueMicrotask(() => input?.focus())
    }
  })
  const close = () => {
    closePalette()
    const el = before
    before = null
    if (el instanceof HTMLElement && el.isConnected) el.focus()
  }

  const run = (fn: () => void) => {
    close()
    fn()
  }

  return (
    <Show when={paletteMode()}>
      {(mode) => (
        <div class="palette-scrim" data-component="palette" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <Cmdk
            class="palette-panel"
            label="Command palette"
            loop
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Escape") {
                e.preventDefault()
                close()
              }
            }}
          >
            <Cmdk.Input
              ref={input}
              class="palette-input"
              placeholder={mode() === "chats" ? "Go to chat…" : mode() === "reasoning" ? "Reasoning…" : "Type a command…"}
              autofocus
            />
            <Cmdk.List class="palette-list">
              <Cmdk.Empty class="palette-empty">No results</Cmdk.Empty>
              <Show
                when={mode() === "commands"}
                fallback={
                  <Show
                    when={mode() === "reasoning"}
                    fallback={
                  <For each={chats()}>
                    {(chat) => (
                      <Cmdk.Item class="palette-row" value={`${chat.id} ${chat.name.toLowerCase()}`} onSelect={() => run(() => navigate(`/chat/${chat.id}`))}>
                        <ChatAvatar faces={useApp.chatFaces(chat.id)} size={18} />
                        <span class="palette-label">{chat.name}</span>
                      </Cmdk.Item>
                    )}
                  </For>
                    }
                  >
                    <Cmdk.Group class="palette-group" heading={`Reasoning for ${target()?.name ?? "the agent"}`}>
                      <For each={levels()}>
                        {(level) => (
                          <Cmdk.Item
                            class="palette-row"
                            value={THINKING_LABELS[level]}
                            data-level={level}
                            onSelect={() => run(() => useApp.setAgentModel(target()!.slug, { thinking: level as ThinkingLevel }))}
                          >
                            <span class="palette-label">{THINKING_LABELS[level]}</span>
                            <Show when={level === picked()?.thinking}>
                              <span class="palette-keys">Current</span>
                            </Show>
                            <Show when={level === defaultThinking(levels())}>
                              <span class="palette-keys">Default</span>
                            </Show>
                          </Cmdk.Item>
                        )}
                      </For>
                    </Cmdk.Group>
                  </Show>
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <Cmdk.Group class="palette-group" heading={group.label}>
                      <For each={group.rows}>
                        {(command) => (
                          <Cmdk.Item class="palette-row" value={`${group.label} ${command.title}`} onSelect={() => run(command.run)}>
                            <HugeIcon icon={iconFor(command.icon)} size={16} />
                            <span class="palette-label">{command.title}</span>
                            <Show when={command.shortcut}>
                              {(shortcut) => <span class="palette-keys">{displayShortcut(shortcut())}</span>}
                            </Show>
                          </Cmdk.Item>
                        )}
                      </For>
                    </Cmdk.Group>
                  )}
                </For>
              </Show>
            </Cmdk.List>
          </Cmdk>
        </div>
      )}
    </Show>
  )
}
