import { Command as Cmdk } from "cmdk-solid"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ArrowUpIcon, ChevronRightIcon, CheckIcon } from "@kiko/ui/icons"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { displayShortcut } from "../commands/hotkeys"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { backspaceLeaves, iconFor, keyChips, matchScore, viewFor, type Item } from "./model"
import { backView, closePalette, enterView, paletteStack } from "./state"
import "./palette.css"

/*
 * The command palette, in t3code's shape: a glass panel over a dimmed, blurred app, a search, groups of rows,
 * and a footer of key hints. cmdk-solid filters, ranks, and moves the highlight. A row with a chevron opens a
 * second list; Backspace in an empty search goes back. The palette opens from state alone, so no network is
 * waited on, and it is interactive from its first frame.
 */
const EXIT_MS = 150

function Chips(props: { keys: string[] }) {
  return (
    <span class="palette-keys">
      <For each={props.keys}>{(key) => <kbd class="palette-kbd">{key}</kbd>}</For>
    </span>
  )
}

function Leading(props: { item: Item }) {
  return (
    <Show when={props.item.faces ?? props.item.seed} fallback={<HugeIcon icon={iconFor(props.item.icon ?? "command")} size={16} />}>
      <Show when={props.item.faces} fallback={<IdentityAvatar seed={props.item.seed!} size={18} />}>
        {(faces) => <ChatAvatar faces={faces()} size={18} />}
      </Show>
    </Show>
  )
}

export default function Palette() {
  // The panel stays mounted for a short exit, but stops taking input the moment the palette closes.
  const [kept, setKept] = createSignal<readonly string[] | null>(null)
  const open = () => paletteStack() !== null
  const stack = () => paletteStack() ?? kept() ?? []
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const now = paletteStack()
    clearTimeout(timer)
    if (now) return setKept(now)
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    if (still) setKept(null)
    else timer = setTimeout(() => setKept(null), EXIT_MS)
  })
  onCleanup(() => clearTimeout(timer))

  const [query, setQuery] = createSignal("")
  const view = createMemo(() => viewFor(stack()))
  let input: HTMLInputElement | undefined

  // Focus goes back to where it was, so closing the palette does not strand the person on the page body.
  let before: Element | null = null
  createEffect(() => {
    if (open()) {
      before ??= document.activeElement
      queueMicrotask(() => input?.focus())
    }
  })
  createEffect(on(() => stack().length, () => setQuery(""), { defer: true }))
  const close = () => {
    closePalette()
    const el = before
    before = null
    if (el instanceof HTMLElement && el.isConnected) el.focus()
  }

  const choose = (item: Item) => {
    if (item.submenu) return enterView(item.submenu)
    close()
    item.run()
  }

  return (
    <Show when={kept()}>
      <div class="palette-scrim" data-component="palette" data-closing={open() ? undefined : ""} onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <Cmdk
          class="palette-panel"
          label="Command palette"
          loop
          filter={(_value, search, keywords) => matchScore(search, keywords?.[0] ?? "", keywords?.[1] ?? "")}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Escape") {
              e.preventDefault()
              close()
            } else if (e.key === "Backspace" && backspaceLeaves(stack(), query())) {
              e.preventDefault()
              backView()
            }
          }}
        >
          <Cmdk.Input ref={input} class="palette-input" placeholder={view().placeholder} value={query()} onValueChange={setQuery} autofocus />
          <Cmdk.List class="palette-list">
            <Cmdk.Empty class="palette-empty">No results</Cmdk.Empty>
            <For each={view().groups}>
              {(group) => (
                <Cmdk.Group class="palette-group" heading={group.label ?? undefined}>
                  <For each={group.items}>
                    {(item) => (
                      <Cmdk.Item class="palette-row" value={item.key} keywords={[item.title, group.label ?? ""]} onSelect={() => choose(item)}>
                        <Leading item={item} />
                        <span class="palette-label">{item.title}</span>
                        <Show when={item.current}>
                          <HugeIcon icon={CheckIcon} size={14} class="palette-trail" />
                        </Show>
                        <Show when={item.shortcut}>{(shortcut) => <Chips keys={keyChips(displayShortcut(shortcut()))} />}</Show>
                        <Show when={item.submenu}>
                          <HugeIcon icon={ChevronRightIcon} size={14} class="palette-trail" />
                        </Show>
                      </Cmdk.Item>
                    )}
                  </For>
                </Cmdk.Group>
              )}
            </For>
          </Cmdk.List>
          <div class="palette-footer">
            <span class="palette-hint">
              <kbd class="palette-kbd"><HugeIcon icon={ArrowUpIcon} size={12} /></kbd>
              <kbd class="palette-kbd palette-kbd-down"><HugeIcon icon={ArrowUpIcon} size={12} /></kbd>
              Navigate
            </span>
            <span class="palette-hint"><kbd class="palette-kbd">Enter</kbd>Select</span>
            <Show when={stack().length > 0}>
              <span class="palette-hint"><kbd class="palette-kbd">Backspace</kbd>Back</span>
            </Show>
            <span class="palette-hint"><kbd class="palette-kbd">Esc</kbd>Close</span>
          </div>
        </Cmdk>
      </div>
    </Show>
  )
}
