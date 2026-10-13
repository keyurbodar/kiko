import { For, createEffect, createMemo, createSignal, getOwner, lazy, onMount, runWithOwner, Show, Suspense, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { ArrowUpIcon, CornerDownLeftIcon, PaperclipIcon, PlusIcon, SquareIcon, XIcon } from "lucide-solid"
import { useI18n } from "@kiko/ui/context/i18n"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { identityLook } from "../../lib/identity"
import { isImage } from "../../lib/attachments"
import type { PromptInputV2Attachment, PromptInputV2Prompt } from "./types"
import type { PromptInputV2Interaction } from "./interaction"
import { createComposerEmoji, createShortcodes } from "../emoji"
import type { RichBinding } from "../rich/bind"

export type {
  PromptInputV2Attachment,
  PromptInputV2Option,
  PromptInputV2PersistedState,
  PromptInputV2Suggestion,
} from "./types"

export type PromptInputV2Mode = "normal" | "shell"

/* The attachment strip and the popover show only with content. See extras.tsx. */
const extras = () => import("./extras")
const PromptInputV2Attachments = lazy(() => extras().then((m) => ({ default: m.PromptInputV2Attachments })))
const PromptInputV2Popover = lazy(() => extras().then((m) => ({ default: m.PromptInputV2Popover })))

export type PromptInputV2Props = {
  controller: PromptInputV2Interaction
  disabled?: boolean
  readOnly?: boolean
  borderUnderlay?: boolean
  class?: string
  modelControl?: JSX.Element
  variantControlVisible?: boolean
  attachKeybind?: string[]
  attachShortcut?: string
  /** Optional bar rendered at the top of the input surface, e.g. an active reply-to chip. */
  reply?: JSX.Element
  /** The slugs `@name` turns into a mention for. */
  isMention?: (slug: string) => boolean
}

export function PromptInputV2(props: PromptInputV2Props) {
  const i18n = useI18n()
  const state = props.controller.state
  const view = props.controller.view
  let editor: HTMLDivElement | undefined
  let localInput = false
  const [blank, setBlank] = createSignal(true)
  // textContent drops line breaks, so a new empty line would hide the placeholder only sometimes. The
  // rich editor knows its own document; the plain field is only the first paint before it mounts.
  const syncBlank = () => setBlank(binding ? binding.editor.isEmpty() : !(editor?.textContent ?? ""))
  const updateCursor = () => {
    if (!editor || !window.getSelection()?.isCollapsed) return
    props.controller.onCursor(promptInputV2Cursor(editor))
  }
  const shortcodes = createShortcodes(() => editor)
  // The chat column's box, inset 8px, while files are dragged over the page.
  const dropArea = createMemo(() => {
    if (state.drag !== "active") return null
    const column = editor?.closest('[data-component="chat-shell"]') ?? editor?.closest("form")
    const box = column?.getBoundingClientRect()
    if (!box) return null
    return { top: `${box.top + 8}px`, left: `${box.left + 8}px`, width: `${box.width - 16}px`, height: `${box.height - 16}px` }
  })
  const emoji = createComposerEmoji(() => editor, () => !!props.disabled || !!props.readOnly)
  let richHost: HTMLDivElement | undefined
  let binding: RichBinding | undefined
  const [rich, setRich] = createSignal(false)
  const [link, setLink] = createSignal<string | null>(null)
  const owner = getOwner()

  // The first attachment or popover should not wait on the network.
  onMount(() => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => void extras(), { timeout: 2000 })
    else setTimeout(() => void extras(), 300)
    void import("../rich/bind").then(({ bindRich }) => {
      if (!richHost || !owner) return
      const typing = document.activeElement === editor
      binding = runWithOwner(owner, () =>
        bindRich({
          host: richHost!,
          controller: props.controller,
          label: i18n.t("ui.promptInput.label"),
          isMention: (slug) => props.isMention?.(slug) ?? false,
          disabled: () => !!props.disabled || !!props.readOnly,
          shortcodes,
          onEdit: syncBlank,
          onLink: setLink,
          onFocus: () => {},
        }),
      )
      if (!binding) return
      editor = binding.editor.dom as HTMLDivElement
      setRich(true)
      syncBlank()
      if (typing) binding.editor.focus()
    })
  })

  createEffect(() => {
    const parts = props.controller.parts()
    if (!editor || rich()) return
    if (localInput) {
      localInput = false
      syncBlank()
      return
    }
    renderPromptInputV2Editor(editor, parts)
    syncBlank()
  })

  return (
    <div class={`relative flex flex-col ${props.class ?? ""}`}>
      <input
        ref={props.controller.setFileInput}
        type="file"
        multiple
        aria-label="Attach files"
        class="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          /*
           * Cleared BEFORE handing the files on. The input keeps its selection
           * after a change, and a change event only fires when the value
           * actually differs — so without this, picking the same file twice in
           * a row does nothing at all and reads as a broken button. The File
           * objects are already captured above, so clearing loses nothing.
           */
          event.currentTarget.value = ""
          if (files.length > 0) props.controller.addAttachments(files)
        }}
      />
      {shortcodes.view}
      {emoji.view}
      <Show when={state.popover.type !== "closed"}>
        <Suspense>
          <PromptInputV2Popover
            emptyLabel={i18n.t("ui.promptInput.noMatchingItems")}
            items={props.controller.suggestions()}
            activeID={state.popover.type === "closed" ? undefined : state.popover.activeID}
            search={
              state.popover.type === "command-menu"
                ? {
                    value: state.popover.query,
                    label: i18n.t("ui.promptInput.commands"),
                    placeholder: "/",
                    onValueChange: props.controller.setQuery,
                    onKeyDown: props.controller.onKeyDown,
                  }
                : undefined
            }
            onActiveChange={(item) => props.controller.dispatch({ type: "popover.active", id: item.id })}
            onSelect={(item) => props.controller.dispatch({ type: "popover.select", item })}
          />
        </Suspense>
      </Show>
      {/* t3code's drop overlay, over the chat column. A drop anywhere attaches. The column is
          measured once when a drag starts, so the overlay needs no positioned ancestor. */}
      <Show when={dropArea()}>
        {(area) => (
          <Portal>
            <div
              class="pointer-events-none fixed z-40 flex items-center justify-center rounded-2xl border border-dashed border-accent/60 bg-accent/[0.035]"
              style={area()}
              data-component="composer-drop-overlay"
            >
              <div role="status" class="flex items-center gap-2 rounded-full border border-accent/25 bg-bg/95 px-4 py-2.5 text-sm font-medium text-text shadow-lg">
                <PaperclipIcon class="size-4 text-accent" />
                {i18n.t("ui.promptInput.dropFiles")}
              </div>
            </div>
          </Portal>
        )}
      </Show>
      <form
        data-component="prompt-input-v2"
        data-dock-border-underlay={props.borderUnderlay ? "v2" : undefined}
        class="flex flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          if (!props.disabled) props.controller.submit()
        }}
      >
        <div class="composer-bar">
          <button
            type="button"
            class="composer-attach"
            data-hint="chat.attach"
            data-hint-side="left"
            disabled={state.mode === "shell"}
            title={i18n.t("ui.promptInput.add")}
            aria-label={i18n.t("ui.promptInput.add")}
            onClick={() => props.controller.attach()}
          >
            <PlusIcon class="size-4" />
          </button>
          <div class="composer-row">
          {props.reply}
          <Show when={state.mode === "normal" && props.controller.attachments().some((a) => isImage({ name: a.filename, type: a.mime }))}>
            <Suspense>
              <PromptInputV2Attachments
                attachments={props.controller.attachments()}
                onImageClick={props.controller.openAttachment}
                onRemove={(attachment) => props.controller.removeAttachment(attachment.id)}
              />
            </Suspense>
          </Show>
          <Show when={state.mode === "normal" && props.controller.attachments().some((a) => !isImage({ name: a.filename, type: a.mime }))}>
            <div class="composer-file-chips" style={{ display: "flex", gap: "6px", "flex-wrap": "wrap", width: "100%" }}>
              <For each={props.controller.attachments().filter((a) => !isImage({ name: a.filename, type: a.mime }))}>
                {(attachment) => (
                  <div class="composer-file-chip" style={{ display: "inline-flex", "align-items": "center", gap: "6px", padding: "4px 8px", "border-radius": "8px", "font-size": "12px", background: "color-mix(in oklab, var(--text) 6%, transparent)" }}>
                    <span>{attachment.filename}</span>
                    <button type="button" aria-label={`Remove ${attachment.filename}`} onClick={() => props.controller.removeAttachment(attachment.id)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <XIcon size={12} />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div
            data-component="prompt-input-box"
            class="composer-input-wrap"
          >
            <Show when={link() !== null}>
              <form
                class="composer-link"
                onSubmit={(event) => {
                  event.preventDefault()
                  const value = new FormData(event.currentTarget).get("href")
                  binding?.editor.setLink(typeof value === "string" ? value.trim() || null : null)
                  setLink(null)
                }}
              >
                <input
                  name="href"
                  type="url"
                  value={link() ?? ""}
                  placeholder="Link address"
                  aria-label="Link address"
                  ref={(element) => requestAnimationFrame(() => element.focus())}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    event.stopPropagation()
                    setLink(null)
                    binding?.editor.focus()
                  }}
                />
              </form>
            </Show>
            <div ref={richHost} class="composer-rich" />
            <Show when={!rich()}>
              <div
                ref={(element) => {
                  editor = element
                  props.controller.setEditor(element)
                  renderPromptInputV2Editor(element, props.controller.parts())
                }}
                data-component="prompt-input"
                role="textbox"
                aria-multiline="true"
                aria-label={i18n.t("ui.promptInput.label")}
                contenteditable={!props.disabled && !props.readOnly}
                autocapitalize={state.mode === "normal" ? "sentences" : "off"}
                autocorrect={state.mode === "normal" ? "on" : "off"}
                spellcheck={state.mode === "normal"}
                // @ts-expect-error
                autocomplete="off"
                class="composer-input focus:outline-none empty:before:content-['\200B'] [&_[data-mention=file]]:text-syntax-property [&_[data-mention=agent]]:text-syntax-type [&_[data-mention=reference]]:text-syntax-keyword"
                classList={{ "font-mono!": state.mode === "shell", "opacity-50": props.disabled }}
                onInput={(event) => {
                  const cursor = promptInputV2Cursor(event.currentTarget)
                  const prompt = parsePromptInputV2Editor(event.currentTarget)
                  const images = props.controller.parts().filter((part) => part.type === "image")
                  localInput = true
                  syncBlank()
                  props.controller.onInput(prompt.map((part) => part.content).join(""), [...prompt, ...images], cursor)
                  shortcodes.sync()
                }}
                onKeyDown={(event) => {
                  if (shortcodes.onKeyDown(event)) return
                  if (props.controller.onKeyDown(event)) return
                  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                    event.preventDefault()
                    if (event.repeat) return
                    props.controller.submit()
                  }
                }}
                onKeyUp={(event) => {
                  syncBlank()
                  updateCursor()
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") shortcodes.sync()
                }}
                onPointerUp={() => {
                  syncBlank()
                  updateCursor()
                  shortcodes.sync()
                }}
                onBlur={shortcodes.close}
                onPaste={props.controller.onPaste}
                onFocus={() => props.controller.dispatch({ type: "focus.editor" })}
              />
            </Show>
            <Show when={blank()}>
              <div class="composer-placeholder" classList={{ "font-mono!": state.mode === "shell" }}>
                {view.placeholder?.() ?? i18n.t("ui.promptInput.label")}
              </div>
            </Show>
          </div>

          {emoji.trigger}

          <PromptInputV2SubmitButton
            mode={state.mode}
            stopping={view.submit.stopping()}
            disabled={!props.controller.canSubmit()}
            blocked={view.submit.blocked?.() ?? null}
            sendLabel={i18n.t(view.submit.preparing?.() ? "ui.promptInput.preparing" : "ui.promptInput.send")}
            stopLabel={i18n.t("ui.promptInput.stop")}
            onSubmit={props.controller.submit}
            onStop={props.controller.stop}
          />
          </div>
        </div>
      </form>
    </div>
  )
}

function renderPromptInputV2Editor(editor: HTMLDivElement, prompt: PromptInputV2Prompt) {
  const active = document.activeElement === editor
  editor.replaceChildren(
    ...prompt.flatMap<Node>((part) => {
      if (part.type === "image") return []
      if (part.type === "text") return [document.createTextNode(part.content)]
      const mention = document.createElement("span")
      mention.textContent = part.content
      mention.contentEditable = "false"
      mention.dataset.mention =
        part.type === "file" && part.mime === "application/x-directory" ? "reference" : part.type
      if (part.type === "agent") {
        mention.dataset.name = part.name
        // The agent's own colour, the one its name and chips wear in the transcript.
        mention.style.color = identityLook(part.name).color
      }
      if (part.type === "file") {
        mention.dataset.path = part.path
        if (part.mime) mention.dataset.mime = part.mime
        if (part.filename) mention.dataset.filename = part.filename
      }
      return [mention]
    }),
  )
  if (!active) return
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function parsePromptInputV2Editor(editor: HTMLDivElement) {
  const parts: Exclude<PromptInputV2Prompt[number], PromptInputV2Attachment>[] = []
  let buffer = ""
  let position = 0

  const flush = () => {
    if (!buffer) return
    parts.push({ type: "text", content: buffer, start: position, end: position + buffer.length })
    position += buffer.length
    buffer = ""
  }
  const mention = (element: HTMLElement) => {
    flush()
    const content = element.textContent ?? ""
    if (element.dataset.mention === "agent") {
      parts.push({
        type: "agent",
        name: element.dataset.name ?? content.slice(1),
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
      return
    }
    parts.push({
      type: "file",
      path: element.dataset.path ?? content.slice(1),
      content,
      start: position,
      end: position + content.length,
      ...(element.dataset.mime ? { mime: element.dataset.mime } : {}),
      ...(element.dataset.filename ? { filename: element.dataset.filename } : {}),
    })
    position += content.length
  }
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += node.textContent ?? ""
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.dataset.mention) {
      mention(node)
      return
    }
    if (node.tagName === "BR") {
      buffer += "\n"
      return
    }
    Array.from(node.childNodes).forEach(visit)
  }

  // Each line after the first is a block, and the browser leaves the first line as bare text when
  // the text was pasted or typed before the first Enter. A block starts a new line after anything
  // that did not end one, and a block holding only <br> is an empty line, not two.
  const ended = () => {
    const tail = buffer || parts.at(-1)?.content || ""
    return tail === "" || tail.endsWith("\n")
  }
  Array.from(editor.childNodes).forEach((node, index, nodes) => {
    const block = node instanceof HTMLElement && ["DIV", "P"].includes(node.tagName)
    if (!block) return visit(node)
    if (!ended()) buffer += "\n"
    const empty = node.childNodes.length === 1 && node.firstChild instanceof HTMLElement && node.firstChild.tagName === "BR"
    if (!empty) visit(node)
    if (index < nodes.length - 1) buffer += "\n"
  })
  flush()
  if (
    parts.every((part) => part.type === "text") &&
    parts.every((part) => part.content.replace(/[\n\u200B]/g, "") === "")
  ) {
    return [{ type: "text" as const, content: "", start: 0, end: 0 }]
  }
  if (parts.length > 0) return parts
  return [{ type: "text" as const, content: "", start: 0, end: 0 }]
}

function promptInputV2Cursor(editor: HTMLDivElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return editor.textContent?.length ?? 0
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  range.setEnd(selection.anchorNode!, selection.anchorOffset)
  return range.toString().length
}

export function PromptInputV2SubmitButton(props: {
  mode: PromptInputV2Mode
  stopping: boolean
  disabled: boolean
  /** Why sending waits, in t3code's words. Shown as the button's tooltip and name while it is off. */
  blocked?: string | null
  sendLabel: string
  stopLabel: string
  onSubmit: () => void
  onStop: () => void
}) {
  const label = () => (props.stopping ? props.stopLabel : (props.blocked ?? props.sendLabel))
  return (
    <TooltipV2
      placement="top"
      inactive={!props.stopping && props.disabled && !props.blocked}
      value={label()}
    >
      <button
        data-action="prompt-submit"
        type="button"
        disabled={!props.stopping && props.disabled}
        tabIndex={props.mode === "normal" ? undefined : -1}
        class="composer-send"
        aria-label={label()}
        title={props.blocked ?? undefined}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (props.stopping) {
            props.onStop()
            return
          }
          props.onSubmit()
        }}
      >
        {props.stopping ? (
          <SquareIcon class="size-3 fill-current" aria-hidden="true" />
        ) : props.mode === "shell" ? (
          <CornerDownLeftIcon class="size-4" aria-hidden="true" />
        ) : (
          <ArrowUpIcon class="size-4" aria-hidden="true" />
        )}
      </button>
    </TooltipV2>
  )
}
