import { useNavigate } from "@solidjs/router"
import { Command as Cmdk } from "cmdk-solid"
import { Icon } from "@kiko/ui/icon"
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

  createEffect(() => {
    if (paletteMode()) queueMicrotask(() => input?.focus())
  })

  const run = (fn: () => void) => {
    closePalette()
    fn()
  }

  return (
    <Show when={paletteMode()}>
      {(mode) => (
        <div class="palette-scrim" data-component="palette" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
          <Cmdk
            class="palette-panel"
            label="command palette"
            loop
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Escape") {
                e.preventDefault()
                closePalette()
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
                        <Icon name="bubble-5" size="small" />
                        <span class="palette-label">{chat.name.toLowerCase()}</span>
                      </Cmdk.Item>
                    )}
                  </For>
                }
              >
                <For each={rows()}>
                  {(command) => (
                    <Cmdk.Item class="palette-row" value={command.title} onSelect={() => run(command.run)}>
                      <Icon name={iconFor(command.icon) as never} size="small" />
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
