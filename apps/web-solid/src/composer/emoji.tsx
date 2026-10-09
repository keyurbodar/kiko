import { createEventListener } from "@solid-primitives/event-listener"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { SmileIcon } from "@kiko/ui/icons"
import { createEffect, createMemo, createResource, createSignal, For, lazy, on, Show, Suspense, type JSX } from "solid-js"
import { loadEmoji, recordRecent, searchEmoji, shortcodeQuery, warmEmoji, type EmojiMatch } from "../lib/emoji-data"

/* The picker loads on the first hover or press of the emoji button. */
const pickerModule = () => import("../chat/ui/EmojiPicker")
const EmojiPicker = lazy(() => pickerModule().then((m) => ({ default: m.EmojiPicker })))

/**
 * Put text in place of `range` in the editor, as typing would. `insertText`
 * keeps the browser's undo stack and fires the editor's own input event, so the
 * draft updates through the one path typing uses.
 */
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

/** The caret, when it is a collapsed caret inside the editor. */
function caretIn(editor: HTMLElement): Range | undefined {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) return undefined
  return selection.getRangeAt(0).cloneRange()
}

/**
 * The `:shortcode` list above the composer. It reads the text node at the caret,
 * so it opens and closes with typing and with caret moves alike.
 */
export function createShortcodes(editor: () => HTMLElement | undefined) {
  const [typed, setTyped] = createSignal<{ node: Text; start: number; end: number; query: string }>()
  const [active, setActive] = createSignal(0)
  const [data] = createResource(() => typed() !== undefined || undefined, loadEmoji)
  const matches = createMemo<EmojiMatch[]>(() => {
    const at = typed()
    return at ? searchEmoji(data() ?? [], at.query) : []
  })
  createEffect(on(() => typed()?.query, () => setActive(0)))
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

  /** True when the key was the list's. While it is open, Enter picks rather than sends. */
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!open() || event.isComposing) return false
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
        class="absolute right-0 bottom-full left-0 z-30 mx-1.5 mb-1.5 max-h-[322px] overflow-y-auto rounded-[16px] bg-menu p-1 text-text shadow-popover"
        role="listbox"
        aria-label="Emoji"
        data-component="emoji-shortcodes"
        // Keep the editor's focus and caret through a click.
        onPointerDown={(event) => event.preventDefault()}
      >
        <For each={matches()}>
          {(match, index) => (
            <div
              role="option"
              aria-selected={active() === index()}
              class="flex h-10 cursor-default items-center gap-3 rounded-[10px] px-2.5 data-[active]:bg-[var(--selected-bg)]"
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
              <span class="truncate text-[14px] font-semibold">
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

/** `:shortcode:` with the typed part on an accent wash. */
function Shortcode(props: { match: EmojiMatch; query: string }): JSX.Element {
  const parts = () => {
    const { shortcode, at } = props.match
    if (at < 0) return [shortcode, "", ""]
    return [shortcode.slice(0, at), shortcode.slice(at, at + props.query.length), shortcode.slice(at + props.query.length)]
  }
  return (
    <>
      :{parts()[0]}
      <Show when={parts()[1]}>
        <mark class="rounded-[3px] bg-accent-wash-strong text-inherit">{parts()[1]}</mark>
      </Show>
      {parts()[2]}:
    </>
  )
}

/**
 * The composer's emoji button and its picker. The picker opens above the
 * composer and puts the pick at the caret the editor had when the button was
 * pressed. The two are rendered apart: the picker sits outside the composer
 * box, whose own backdrop blur would otherwise flatten the picker's.
 */
export function createComposerEmoji(editor: () => HTMLElement | undefined, disabled: () => boolean) {
  const [open, setOpen] = createSignal(false)
  let saved: Range | undefined
  let button: HTMLButtonElement | undefined
  let panel: HTMLDivElement | undefined
  const warm = () => {
    void pickerModule()
    warmEmoji()
  }
  const remember = () => {
    const root = editor()
    saved = root ? caretIn(root) : undefined
  }
  const pick = (emoji: string) => {
    setOpen(false)
    const root = editor()
    if (!root) return
    let range = saved
    if (!range || !root.contains(range.startContainer)) {
      range = document.createRange()
      range.selectNodeContents(root)
      range.collapse(false)
    }
    insertAt(root, range, emoji)
  }

  createEventListener(document, "pointerdown", (event) => {
    const target = event.target as Node
    if (open() && !panel?.contains(target) && !button?.contains(target)) setOpen(false)
  })
  // On the window in the capture phase, so the Escape stops before any document listener sees it.
  createEventListener(window, "keydown", (event) => {
    if (!open() || event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    editor()?.focus({ preventScroll: true })
  }, { capture: true })

  const trigger = (
    <button
      ref={button}
      type="button"
      class="composer-emoji"
      aria-label="Emoji"
      aria-expanded={open()}
      data-action="composer-emoji"
      disabled={disabled()}
      onPointerEnter={warm}
      onPointerDown={remember}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") remember()
      }}
      onClick={() => {
        warm()
        setOpen((value) => !value)
      }}
    >
      <HugeIcon icon={SmileIcon} size={16} />
    </button>
  )
  const view = (
    <Show when={open()}>
      <div ref={panel} class="absolute right-1.5 bottom-full z-30 mb-1.5">
        <Suspense>
          <EmojiPicker onSelect={pick} />
        </Suspense>
      </div>
    </Show>
  )
  return { trigger, view }
}
