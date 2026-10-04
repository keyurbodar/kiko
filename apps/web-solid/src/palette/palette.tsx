import { useNavigate } from "@solidjs/router"
import { Command as Cmdk } from "cmdk-solid"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { For, Show, createEffect, createMemo } from "solid-js"
import { displayShortcut } from "../commands/hotkeys"
import { useApp } from "../lib/store"
import { closePalette, paletteMode } from "./state"
import { iconFor, paletteRows } from "./model"
import "./palette.css"

/*
 * kat's command palette (screenshot 20). cmdk-solid filters, ranks, and moves
 * the highlight; the rows come from the registry, or from the chat list in
 * chat mode. Nothing here animates.
 */
export default function Palette() {
  const navigate = useNavigate()
  const rows = createMemo(() => paletteRows())
  const chats = createMemo(() => useApp.bots())
  let input: HTMLInputElement | undefined

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
            label="command palette"
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
              placeholder={mode() === "chats" ? "go to chat..." : "type a command..."}
              autofocus
            />
            <Cmdk.List class="palette-list">
              <Cmdk.Empty class="palette-empty">no results</Cmdk.Empty>
              <Show
                when={mode() === "commands"}
                fallback={
                  <For each={chats()}>
                    {(chat) => (
                      <Cmdk.Item class="palette-row" value={`${chat.id} ${chat.name.toLowerCase()}`} onSelect={() => run(() => navigate(`/chat/${chat.id}`))}>
                        <ChatAvatar faces={useApp.chatFaces(chat.id)} size={18} />
                        <span class="palette-label">{chat.name.toLowerCase()}</span>
                      </Cmdk.Item>
                    )}
                  </For>
                }
              >
                <For each={rows()}>
                  {(command) => (
                    <Cmdk.Item class="palette-row" value={command.title} onSelect={() => run(command.run)}>
                      <HugeIcon icon={iconFor(command.icon)} size={16} />
                      <span class="palette-label">{command.title}</span>
                      <Show when={command.shortcut}>
                        {(shortcut) => <span class="palette-keys">{displayShortcut(shortcut())}</span>}
                      </Show>
                    </Cmdk.Item>
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
