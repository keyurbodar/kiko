import { Command as Cmdk } from "cmdk-solid"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ArrowUpIcon, ChevronRightIcon, CheckIcon } from "@kiko/ui/icons"
import { snippetParts } from "@kiko/protocol"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { displayShortcut } from "../commands/hotkeys"
import { commands } from "../commands/registry"
import { EntryIcon } from "../lib/EntryIcon"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { backspaceLeaves, createPreview, emptyText, enterLabel, iconFor, keyChips, rowScore, searchGroups, viewFor, type Item } from "./model"
import { backView, closePalette, enterView, paletteStack } from "./state"
import "./palette.css"

const EXIT_MS = 150

function Chips(props: { keys: string[] }) {
  return (
    <span class="palette-keys">
      <For each={props.keys}>{(key) => <kbd class="palette-kbd">{key}</kbd>}</For>
    </span>
  )
}

function Marked(props: { text: string; query?: string }) {
  const parts = createMemo(() => {
    const q = props.query?.trim().toLowerCase()
    const at = q ? props.text.toLowerCase().indexOf(q) : -1
    if (!q || at < 0) return [{ text: props.text, match: false }]
    return [
      { text: props.text.slice(0, at), match: false },
      { text: props.text.slice(at, at + q.length), match: true },
      { text: props.text.slice(at + q.length), match: false },
    ].filter((p) => p.text)
  })
  return <For each={parts()}>{(part) => (part.match ? <mark class="palette-mark">{part.text}</mark> : part.text)}</For>
}

function Leading(props: { item: Item }) {
  return (
    <Show when={props.item.file} fallback={<Plain item={props.item} />}>
      {(path) => (
        <span class="palette-file-icon">
          <EntryIcon path={path()} />
        </span>
      )}
    </Show>
  )
}

function Plain(props: { item: Item }) {
  return (
    <Show when={props.item.chatId ?? props.item.seed} fallback={<RemixIcon icon={iconFor(props.item.icon ?? "command")} size={16} />}>
      <Show when={props.item.chatId} fallback={<IdentityAvatar seed={props.item.seed!} size={18} />}>
        {(id) => <ChatAvatar faces={useApp.chatFaces(id())} size={18} />}
      </Show>
    </Show>
  )
}

export default function Palette() {
  const [query, setQuery] = createSignal("")
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

  const typed = createMemo(() => query().trim() !== "")
  const view = createMemo(() => viewFor(stack(), commands(), typed()))
  const searching = () => view().parent?.search
  const groups = createMemo(() => {
    const parent = view().parent
    return parent?.search ? searchGroups(parent, query()) : view().groups
  })
  let input: HTMLInputElement | undefined
  const [highlight, setHighlight] = createSignal("")

  let before: Element | null = null
  createEffect(() => {
    if (open()) {
      before ??= document.activeElement
      setHighlight("")
      queueMicrotask(() => input?.focus())
    }
  })
  createEffect(on(() => stack().length, () => setQuery(""), { defer: true }))
  createEffect(() => view().parent?.onQuery?.(query()))
  createEffect(on(() => view().parent, (_now, before) => before?.onQuery?.(""), { defer: true }))
  const preview = createPreview()
  let engaged = false
  const items = () => groups().flatMap((g) => g.items)
  createEffect(() => {
    const key = highlight()
    const item = items().find((i) => i.key === key)
    if (engaged && open()) preview.show(item)
  })
  createEffect(
    on(
      () => stack().join("/"),
      () => {
        engaged = false
        setHighlight("")
        preview.restore()
      },
      { defer: true },
    ),
  )
  onCleanup(() => preview.restore())

  const close = () => {
    preview.restore()
    closePalette()
    const el = before
    before = null
    if (el instanceof HTMLElement && el.isConnected) el.focus()
  }

  const choose = (item: Item) => {
    if (item.submenu) return enterView(item.submenu)
    preview.keep()
    close()
    item.run()
  }

  return (
    <Show when={kept()}>
      <div
        class="palette-scrim"
        data-component="palette"
        ref={(el) => {
          const engage = (event: Event) => {
            if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === "Escape")) return
            engaged = true
          }
          el.addEventListener("keydown", engage, true)
          el.addEventListener("pointermove", engage, true)
        }} data-closing={open() ? undefined : ""}
        onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <Cmdk
          class="palette-panel"
          label="Command palette"
          loop
          value={highlight()}
          onValueChange={setHighlight}
          shouldFilter={!searching()}
          filter={(_value, search, keywords) => rowScore(search, keywords?.[0] ?? "", keywords?.[1] ?? "", Boolean(keywords?.[2]))}
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
          <div class="palette-bar">
            <Show when={view().parent}>{(parent) => <span class="palette-addon" aria-hidden="true"><RemixIcon icon={iconFor(parent().icon)} size={16} /></span>}</Show>
            <Cmdk.Input ref={input} class="palette-input" placeholder={view().placeholder} value={query()} onValueChange={setQuery} autofocus />
          </div>
          <Cmdk.List class="palette-list">
            <Show
              when={searching()}
              fallback={<Cmdk.Empty class="palette-empty">No results</Cmdk.Empty>}
            >
              <Show when={groups().length === 0}>
                <div class="palette-empty" role="status">{emptyText(view().parent, query())}</div>
              </Show>
            </Show>
            <For each={groups()}>
              {(group) => (
                <Cmdk.Group class="palette-group" heading={group.label ?? undefined}>
                  <For each={group.items}>
                    {(item) => (
                      <Cmdk.Item class="palette-row" value={item.key} keywords={[item.title, group.label ?? "", item.chat ? "chat" : ""]} onSelect={() => choose(item)}>
                        <Leading item={item} />
                        <Show
                          when={item.detail || item.snippet}
                          fallback={<span class="palette-label"><Marked text={item.title} query={item.mark} /></span>}
                        >
                          <span class="palette-text">
                            <span class="palette-label"><Marked text={item.title} query={item.mark} /></span>
                            <Show when={item.detail} fallback={<span class="palette-detail"><For each={snippetParts(item.snippet ?? "")}>{(part) => (part.match ? <mark class="palette-mark">{part.text}</mark> : part.text)}</For></span>}>
                              {(detail) => <span class="palette-detail"><Marked text={detail()} query={item.mark} /></span>}
                            </Show>
                          </span>
                        </Show>
                        <Show when={item.swatch}>{(color) => <span class="palette-swatch" style={{ background: color() }} aria-hidden="true" />}</Show>
                        <Show when={item.current}>
                          <RemixIcon icon={CheckIcon} size={14} class="palette-trail" />
                        </Show>
                        <Show when={item.shortcut}>{(shortcut) => <Chips keys={keyChips(displayShortcut(shortcut()))} />}</Show>
                        <Show when={item.submenu}>
                          <RemixIcon icon={ChevronRightIcon} size={14} class="palette-trail" />
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
              <kbd class="palette-kbd"><RemixIcon icon={ArrowUpIcon} size={12} /></kbd>
              <kbd class="palette-kbd palette-kbd-down"><RemixIcon icon={ArrowUpIcon} size={12} /></kbd>
              Navigate
            </span>
            <span class="palette-hint"><kbd class="palette-kbd">Enter</kbd>{enterLabel(view())}</span>
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
