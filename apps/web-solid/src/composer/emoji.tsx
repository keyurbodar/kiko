import { createEffect, createMemo, createResource, createSignal, For, on, Show, type JSX } from "solid-js"
import { composingKey } from "./ime"
import {
  loadEmoji,
  recordRecent,
  searchEmoji,
  shortcodeQuery,
  type EmojiEntry,
  type EmojiMatch,
} from "../lib/emoji-data"

function insertAt(editor: HTMLElement, range: Range, text: string) {
  editor.focus({ preventScroll: true })
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }))
}

function caretIn(editor: HTMLElement): Range | undefined {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) return undefined
  return selection.getRangeAt(0).cloneRange()
}

export function createShortcodes(editor: () => HTMLElement | undefined) {
  const [typed, setTyped] = createSignal<{ node: Text; start: number; end: number; query: string }>()
  const [active, setActive] = createSignal(0)
  const [data] = createResource(
    () => typed() !== undefined || undefined,
    () => loadEmoji().catch(() => []),
    { initialValue: [] as readonly EmojiEntry[] },
  )
  const matches = createMemo<EmojiMatch[]>(() => {
    const at = typed()
    return at ? searchEmoji(data.latest, at.query) : []
  })
  createEffect(
    on(
      () => typed()?.query,
      () => setActive(0),
    ),
  )
  const open = () => matches().length > 0

  const sync = () => {
    const root = editor()
    const caret = root && caretIn(root)
    const node = caret?.startContainer
    if (!caret || !(node instanceof Text)) return void setTyped(undefined)
    const found = shortcodeQuery(node.data, caret.startOffset)
    setTyped(found ? { node, start: found.start, end: caret.startOffset, query: found.query } : undefined)
  }

  const choose = (match: EmojiMatch) => {
    const at = typed()
    const root = editor()
    if (!at || !root || !at.node.isConnected) return
    const range = document.createRange()
    range.setStart(at.node, at.start)
    range.setEnd(at.node, at.end)
    recordRecent(match.entry.emoji)
    setTyped(undefined)
    insertAt(root, range, match.entry.emoji)
  }

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!open() || composingKey(event)) return false
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const count = matches().length
      setActive((index) => (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count)
    } else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      const match = matches()[active()]
      if (match) choose(match)
    } else if (event.key === "Escape") {
      setTyped(undefined)
      event.stopPropagation()
    } else return false
    event.preventDefault()
    return true
  }

  const view = (
    <Show when={open()}>
      <div
        class="absolute right-0 bottom-full left-0 z-30 mx-1.5 mb-1.5 max-h-[322px] overflow-y-auto rounded-card bg-raise p-1 text-fg shadow-popover"
        role="listbox"
        aria-label="Emoji"
        data-component="emoji-shortcodes"
        onPointerDown={(event) => event.preventDefault()}
      >
        <For each={matches()}>
          {(match, index) => (
            <div
              role="option"
              aria-selected={active() === index()}
              class="flex h-10 cursor-default items-center gap-3 rounded-row px-2.5 data-[active]:bg-[var(--active)]"
              data-active={active() === index() ? "" : undefined}
              data-component="emoji-shortcode"
              data-emoji={match.entry.emoji}
              ref={(element) =>
                createEffect(() => {
                  if (active() === index()) element.scrollIntoView({ block: "nearest" })
                })
              }
              onPointerMove={() => setActive(index())}
              onClick={() => choose(match)}
            >
              <span class="w-6 shrink-0 text-center font-emoji text-[20px] leading-none">{match.entry.emoji}</span>
              <span class="truncate text-ui font-semibold">
                <Shortcode match={match} query={typed()?.query ?? ""} />
              </span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )

  return { sync, onKeyDown, view, close: () => setTyped(undefined) }
}

function Shortcode(props: { match: EmojiMatch; query: string }): JSX.Element {
  const parts = () => {
    const { shortcode, at } = props.match
    if (at < 0) return [shortcode, "", ""]
    return [
      shortcode.slice(0, at),
      shortcode.slice(at, at + props.query.length),
      shortcode.slice(at + props.query.length),
    ]
  }
  return (
    <>
      :{parts()[0]}
      <Show when={parts()[1]}>
        <mark class="rounded-tail bg-info-wash text-inherit">{parts()[1]}</mark>
      </Show>
      {parts()[2]}:
    </>
  )
}
