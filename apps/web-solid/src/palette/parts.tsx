import { snippetParts } from "@kiko/protocol"
import { ArrowUpIcon, BackIcon, CheckIcon, ChevronRightIcon, EnterIcon, FolderIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { Command as Cmdk } from "cmdk-solid"
import { createMemo, For, Show, type JSX } from "solid-js"
import { displayShortcut } from "../commands/hotkeys"
import { EntryIcon } from "../lib/EntryIcon"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { isMac } from "../lib/platform"
import { room } from "../state/room"
import { iconFor, keyChips, type Item } from "./model"

export type KeyName = "enter" | "tab" | "esc" | "up-down" | "left" | "right" | "space" | "alt-enter" | "mod-enter"

const MOD = isMac ? "⌘" : "Ctrl"
const ALT = isMac ? "⌥" : "Alt"

export function Key(props: { name: KeyName }) {
  return (
    <Show
      when={props.name === "up-down"}
      fallback={
        <kbd class="palette-kbd" data-key={props.name}>
          {props.name === "enter" && <RemixIcon icon={EnterIcon} size={12} />}
          {props.name === "tab" && "Tab"}
          {props.name === "esc" && "Esc"}
          {props.name === "space" && "Space"}
          {props.name === "left" && <RemixIcon icon={BackIcon} size={12} />}
          {props.name === "right" && <RemixIcon icon={BackIcon} size={12} class="palette-flip" />}
          {props.name === "alt-enter" && (
            <>
              {ALT}
              <RemixIcon icon={EnterIcon} size={12} />
            </>
          )}
          {props.name === "mod-enter" && (
            <>
              {MOD}
              <RemixIcon icon={EnterIcon} size={12} />
            </>
          )}
        </kbd>
      }
    >
      <span class="palette-keys-pair">
        <kbd class="palette-kbd">
          <RemixIcon icon={ArrowUpIcon} size={12} />
        </kbd>
        <kbd class="palette-kbd">
          <RemixIcon icon={ArrowUpIcon} size={12} class="palette-flip-v" />
        </kbd>
      </span>
    </Show>
  )
}

export function Hint(props: { name: KeyName; children: JSX.Element }) {
  return (
    <span class="palette-hint">
      <Key name={props.name} />
      {props.children}
    </span>
  )
}

function Chips(props: { keys: string[] }) {
  return (
    <span class="palette-keys">
      <kbd class="palette-kbd">{props.keys.join(isMac ? "" : "+")}</kbd>
    </span>
  )
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function Marked(props: { text: string; query?: string }) {
  const parts = createMemo(() => {
    const words = props.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? []
    if (!words.length) return [{ text: props.text, match: false }]
    const pattern = new RegExp(`(${words.map(escape).join("|")})`, "gi")
    return props.text
      .split(pattern)
      .filter(Boolean)
      .map((text) => ({ text, match: words.includes(text.toLowerCase()) }))
  })
  return <For each={parts()}>{(part) => (part.match ? <mark class="palette-mark">{part.text}</mark> : part.text)}</For>
}

function Leading(props: { item: Item }) {
  return (
    <Show
      when={props.item.file}
      fallback={
        <Show
          when={props.item.chatId ?? props.item.seed}
          fallback={
            <span class="palette-icon">
              <RemixIcon
                icon={props.item.glyph ?? (props.item.folder ? FolderIcon : iconFor(props.item.icon ?? "command"))}
                size={16}
                class={props.item.icon === "attach" ? "palette-clip" : undefined}
              />
            </span>
          }
        >
          <Show when={props.item.chatId} fallback={<IdentityAvatar seed={props.item.seed!} size={28} />}>
            {(id) => <ChatAvatar faces={room.chatFaces(id())} size={28} />}
          </Show>
        </Show>
      }
    >
      {(path) => (
        <span class="palette-file-icon">
          <EntryIcon path={path()} />
        </span>
      )}
    </Show>
  )
}

function Detail(props: { item: Item }) {
  return (
    <span class="palette-detail">
      <Show when={props.item.from}>
        <b class="palette-from">{props.item.from}:</b>{" "}
      </Show>
      <Show when={props.item.snippet} fallback={<Marked text={props.item.detail ?? ""} query={props.item.mark} />}>
        {(snippet) => (
          <For each={snippetParts(snippet())}>
            {(part) => (part.match ? <mark class="palette-mark">{part.text}</mark> : part.text)}
          </For>
        )}
      </Show>
    </span>
  )
}

export function Row(props: {
  item: Item
  selecting: boolean
  picked: boolean
  onSelect: () => void
  onPick: (event: MouseEvent) => void
}) {
  const two = () => Boolean(props.item.detail || props.item.snippet)
  const selectable = () => Boolean(props.item.file)
  return (
    <Cmdk.Item
      class="palette-row"
      value={props.item.key}
      data-picked={props.picked ? "true" : undefined}
      data-kind={props.item.folder ? "folder" : props.item.file ? "file" : undefined}
      data-two={two() ? "" : undefined}
      onSelect={props.onSelect}
    >
      <Show when={selectable() && (props.selecting || props.picked)}>
        <button
          type="button"
          class="palette-check"
          role="checkbox"
          aria-checked={props.picked}
          aria-label={`Select ${props.item.title}`}
          tabindex="-1"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            props.onPick(e)
          }}
        >
          <Show when={props.picked}>
            <RemixIcon icon={CheckIcon} size={12} />
          </Show>
        </button>
      </Show>
      <Leading item={props.item} />
      <span class="palette-text">
        <span class="palette-label" data-marked={props.item.mark ? "" : undefined}>
          <Marked text={props.item.title} query={props.item.mark} />
        </span>
        <Show when={two()}>
          <Detail item={props.item} />
        </Show>
      </span>
      <Show when={props.item.swatch}>
        {(color) => <span class="palette-swatch" style={{ background: color() }} aria-hidden="true" />}
      </Show>
      <Show when={props.item.meta}>
        {(meta) => (
          <span class="palette-meta" data-tone={props.item.tone}>
            {meta()}
          </span>
        )}
      </Show>
      <Show when={props.item.current}>
        <RemixIcon icon={CheckIcon} size={16} class="palette-trail" />
      </Show>
      <Show when={props.item.shortcut}>{(shortcut) => <Chips keys={keyChips(displayShortcut(shortcut()))} />}</Show>
      <Show when={props.item.submenu || props.item.folder}>
        <RemixIcon icon={ChevronRightIcon} size={16} class="palette-trail" />
      </Show>
      <span class="palette-enter" aria-hidden="true">
        <Key name="enter" />
      </span>
    </Cmdk.Item>
  )
}

export function AskKiko(props: { query: string; onAsk: () => void }) {
  return (
    <button type="button" class="palette-ask" data-action="ask-kiko" onClick={props.onAsk}>
      <span class="palette-ask-face">
        <IdentityAvatar seed="kiko" size={24} />
      </span>
      <span class="palette-ask-text">
        Ask Kiko: <span class="palette-ask-quote">“{props.query}”</span>
      </span>
      <Key name="mod-enter" />
    </button>
  )
}

export function Empty(props: { message: string; sub?: string; onAsk?: () => void }) {
  return (
    <div class="palette-empty" role="status">
      <div class="palette-empty-title">{props.message}</div>
      <Show when={props.sub}>
        <div class="palette-empty-sub">{props.sub}</div>
      </Show>
      <Show when={props.onAsk}>
        <button type="button" class="palette-ask-pill" data-action="ask-kiko" onClick={() => props.onAsk?.()}>
          <IdentityAvatar seed="kiko" size={20} />
          Ask Kiko
          <Key name="mod-enter" />
        </button>
      </Show>
    </div>
  )
}

export function Skeleton() {
  return (
    <div class="palette-skeleton" aria-hidden="true" data-component="palette-skeleton">
      <For each={[62, 48, 70]}>
        {(width) => (
          <div class="palette-skeleton-row">
            <span class="palette-skeleton-dot" />
            <span class="palette-skeleton-bar" style={{ width: `${width}%` }} />
          </div>
        )}
      </For>
    </div>
  )
}
