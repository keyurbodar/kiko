import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { FileIcon } from "@kiko/ui/file-icon"
import { Icon } from "@kiko/ui/icon"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import { useI18n } from "@kiko/ui/context/i18n"
import { ButtonV2 } from "@kiko/ui/v2/button-v2"
import { Icon as IconV2 } from "@kiko/ui/v2/icon"
import { IconButtonV2 } from "@kiko/ui/v2/icon-button-v2"
import { KeybindV2 } from "@kiko/ui/v2/keybind-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { CommentCardV2 } from "../comment-card-v2"
import type {
  PromptInputV2Attachment,
  PromptInputV2Comment,
  PromptInputV2Option,
  PromptInputV2PersistedState,
  PromptInputV2Prompt,
  PromptInputV2Suggestion,
} from "./types"
import type { PromptInputV2Interaction, PromptInputV2SelectControl } from "./interaction"

export type {
  PromptInputV2Attachment,
  PromptInputV2Comment,
  PromptInputV2Option,
  PromptInputV2PersistedState,
  PromptInputV2Suggestion,
} from "./types"

export type PromptInputV2Mode = "normal" | "shell"

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
}

export function PromptInputV2(props: PromptInputV2Props) {
  const i18n = useI18n()
  const state = props.controller.state
  const view = props.controller.view
  let editor: HTMLDivElement | undefined
  let localInput = false
  const [blank, setBlank] = createSignal(true)
  const syncBlank = () => setBlank(!(editor?.textContent ?? ""))
  const updateCursor = () => {
    if (!editor || !window.getSelection()?.isCollapsed) return
    props.controller.onCursor(promptInputV2Cursor(editor))
  }

  createEffect(() => {
    const parts = props.controller.parts()
    if (!editor) return
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
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,application/json,application/toml,application/x-toml,application/x-yaml,application/xml,application/x-xml,.yaml,.yml,.csv,.tsv,.env,.gql,.graphql,.h,.hpp,.html,.ini,.java,.js,.json,.jsx,.log,.md,.mdx,.mjs,.mts,.py,.rb,.rs,.sass,.scss,.sh,.sql,.toml,.ts,.tsx,.txt,.vue,.yaml,.yml,.zsh,.go"
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
      <Show when={state.popover.type !== "closed"}>
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
      </Show>
      <form
        data-component="prompt-input-v2"
        data-dock-border-underlay={props.borderUnderlay ? "v2" : undefined}
        class="flex flex-col"
        classList={{
          "border border-v2-icon-icon-info border-dashed": state.drag === "active",
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (!props.disabled) props.controller.submit()
        }}
        onDragEnter={props.controller.onDragEnter}
        onDragOver={props.controller.onDragOver}
        onDragLeave={props.controller.onDragLeave}
        onDrop={props.controller.onDrop}
      >
        <Show when={state.mode === "normal"}>
          <PromptInputV2Attachments
            attachments={props.controller.attachments()}
            comments={props.controller.comments()}
            activeCommentID={state.activeContextID}
            removeLabel={i18n.t("ui.promptInput.removeAttachment")}
            onAttachmentClick={props.controller.openAttachment}
            onAttachmentRemove={(attachment) => props.controller.removeAttachment(attachment.id)}
            onAttachmentReorder={(id, toId) => props.controller.reorderAttachment(id, toId)}
            onCommentClick={(comment) => props.controller.toggleContext(comment.key)}
            onCommentRemove={(item) => props.controller.removeContext(item.key)}
          />
        </Show>

        <div class="composer-row">
          <button
            type="button"
            class="composer-attach"
            disabled={state.mode === "shell"}
            title={i18n.t("ui.promptInput.add")}
            onClick={() => props.controller.attach()}
          >
            <IconV2 name="plus" class="size-4" />
          </button>

          <div
            data-component="prompt-input-box"
            class="composer-input-wrap"
          >
            <Show when={state.drag === "active"}>
              <div class="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl bg-v2-background-bg-base/90 text-v2-text-text-base">
                {i18n.t("ui.promptInput.dropFiles")}
              </div>
            </Show>

            {props.reply}

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
                setBlank(!event.currentTarget.textContent)
                props.controller.onInput(prompt.map((part) => part.content).join(""), [...prompt, ...images], cursor)
              }}
              onKeyDown={(event) => {
                if (props.controller.onKeyDown(event)) return
                if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                  event.preventDefault()
                  if (event.repeat) return
                  props.controller.submit()
                }
              }}
              onKeyUp={() => {
                syncBlank()
                updateCursor()
              }}
              onPointerUp={() => {
                syncBlank()
                updateCursor()
              }}
              onPaste={props.controller.onPaste}
              onFocus={() => props.controller.dispatch({ type: "focus.editor" })}
            />
            <Show when={blank()}>
              <div class="composer-placeholder" classList={{ "font-mono!": state.mode === "shell" }}>
                {view.placeholder?.() ?? i18n.t("ui.promptInput.label")}
              </div>
            </Show>
          </div>

          <PromptInputV2SubmitButton
            mode={state.mode}
            stopping={view.submit.stopping()}
            disabled={!props.controller.canSubmit()}
            sendLabel={i18n.t("ui.promptInput.send")}
            stopLabel={i18n.t("ui.promptInput.stop")}
            onSubmit={props.controller.submit}
            onStop={props.controller.stop}
          />
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
      if (part.type === "agent") mention.dataset.name = part.name
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

  Array.from(editor.childNodes).forEach((node, index, nodes) => {
    visit(node)
    if (node instanceof HTMLElement && ["DIV", "P"].includes(node.tagName) && index < nodes.length - 1) buffer += "\n"
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

/** Carries the id of a chip being reordered. Not `text/plain`, which the dock reads as an @mention drop. */
const REORDER_TYPE = "application/x-kiko-attachment"

export function PromptInputV2Attachments(props: {
  attachments: PromptInputV2Attachment[]
  comments?: PromptInputV2Comment[]
  activeCommentID?: string
  removeLabel: string
  onAttachmentClick?: (attachment: PromptInputV2Attachment) => void
  onAttachmentRemove: (attachment: PromptInputV2Attachment) => void
  onAttachmentReorder?: (id: string, toId: string) => void
  onCommentClick?: (comment: PromptInputV2Comment) => void
  onCommentRemove?: (comment: PromptInputV2Comment) => void
}) {
  const i18n = useI18n()
  let scroller: HTMLDivElement | undefined
  const [dropTarget, setDropTarget] = createSignal<string>()
  /** Which edges have more strip beyond them, so each fade earns its place. */
  const [edges, setEdges] = createSignal({ start: false, end: false })
  const syncEdges = () => {
    const node = scroller
    if (!node) return
    // A single pixel of slack: a fractional layout width can leave the last
    // position a hair short of the end and strand the fade on screen.
    setEdges({
      start: node.scrollLeft > 1,
      end: node.scrollLeft < node.scrollWidth - node.clientWidth - 1,
    })
  }
  // The strip's own width changes when an attachment is added or removed, so
  // the fades have to be re-read after every list change, not just on scroll.
  // createEffect runs after the render phase, so the new cards are already in
  // the DOM by the time this reads scrollWidth.
  createEffect(() => {
    const count = props.attachments.length + (props.comments?.length ?? 0)
    void count
    syncEdges()
  })
  return (
    <Show when={props.attachments.length > 0 || (props.comments?.length ?? 0) > 0}>
      <div data-component="prompt-input-v2-attachments" data-slot="prompt-attachments" class="relative">
        <div
          ref={(element) => {
            scroller = element
          }}
          data-slot="prompt-attachments-scroll"
          onScroll={syncEdges}
          class="attachment-strip"
        >
          <For each={props.comments ?? []}>
            {(comment) => (
              <div class="relative group shrink-0">
                <TooltipV2
                  value={comment.comment}
                  placement="top"
                  openDelay={800}
                  contentClass="max-w-[300px] break-words"
                >
                  <CommentCardV2
                    comment={comment.comment ?? ""}
                    path={comment.path}
                    selection={comment.selection}
                    active={comment.key === props.activeCommentID}
                    onClick={() => props.onCommentClick?.(comment)}
                  />
                </TooltipV2>
                <button
                  type="button"
                  onClick={() => props.onCommentRemove?.(comment)}
                  class="absolute -top-1 -end-1 size-4 rounded-full bg-v2-icon-icon-muted outline-solid outline-1 outline-v2-icon-icon-contrast flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={props.removeLabel}
                >
                  <IconV2 name="outline-xmark" class="text-v2-icon-icon-contrast" />
                </button>
              </div>
            )}
          </For>
          <For each={props.attachments}>
            {(attachment) => {
              const isImage = () => attachment.mime.startsWith("image/")
              return (
                /* The tooltip wraps the chip rather than living inside it: its
                 * trigger is a wrapper element, and a wrapper inside the chip
                 * would become the flex item that kat's `gap: 6px` measures
                 * between the icon and the name. */
                <TooltipV2 value={attachment.filename} placement="top" contentClass="break-all">
                  <div
                    class="attachment-chip"
                    data-component="composer-attachment"
                    data-image={isImage() ? "" : undefined}
                    data-id={attachment.id}
                    data-drop={dropTarget() === attachment.id ? "" : undefined}
                    draggable={props.onAttachmentReorder !== undefined && props.attachments.length > 1}
                    onDragStart={(event) => {
                      event.dataTransfer?.setData(REORDER_TYPE, attachment.id)
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
                    }}
                    onDragOver={(event) => {
                      if (!event.dataTransfer?.types.includes(REORDER_TYPE)) return
                      event.preventDefault()
                      setDropTarget(attachment.id)
                    }}
                    onDragLeave={() => setDropTarget(undefined)}
                    onDragEnd={() => setDropTarget(undefined)}
                    onDrop={(event) => {
                      const id = event.dataTransfer?.getData(REORDER_TYPE)
                      setDropTarget(undefined)
                      if (!id) return
                      event.preventDefault()
                      event.stopPropagation()
                      props.onAttachmentReorder?.(id, attachment.id)
                    }}
                  >
                    <Show
                      when={isImage()}
                      fallback={
                        <>
                          <FileIcon
                            node={{ path: attachment.filename, type: "file" }}
                            class="attachment-file-icon"
                          />
                          <span class="attachment-filename">{attachment.filename}</span>
                        </>
                      }
                    >
                      <button
                        type="button"
                        class="attachment-thumb-button"
                        onClick={() => props.onAttachmentClick?.(attachment)}
                        aria-label={`open ${attachment.filename}`}
                      >
                        <img
                          src={attachment.blob.url}
                          alt={attachment.filename}
                          class="attachment-thumb"
                        />
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="attachment-remove"
                      onClick={() => props.onAttachmentRemove(attachment)}
                      aria-label={props.removeLabel}
                    >
                      <IconV2 name="outline-xmark" />
                    </button>
                  </div>
                </TooltipV2>
              )
            }}
          </For>
        </div>
        <div
          data-slot="prompt-attachments-fade-left"
          classList={{ invisible: !edges().start }}
          class="pointer-events-none absolute inset-y-0 start-0 z-10 w-6 bg-[linear-gradient(to_right,var(--v2-background-bg-base),transparent)] rtl:bg-[linear-gradient(to_left,var(--v2-background-bg-base),transparent)]"
        />
        <div
          data-slot="prompt-attachments-fade-right"
          classList={{ invisible: !edges().end }}
          class="pointer-events-none absolute inset-y-0 end-0 z-10 w-6 bg-[linear-gradient(to_left,var(--v2-background-bg-base),transparent)] rtl:bg-[linear-gradient(to_right,var(--v2-background-bg-base),transparent)]"
        />
      </div>
    </Show>
  )
}

export function PromptInputV2AddMenu(props: {
  disabled?: boolean
  title: string
  keybind?: string[]
  attachLabel: string
  attachShortcut?: string
  commandsLabel: string
  contextLabel: string
  shellLabel: string
  onAttach: () => void
  onCommands: () => void
  onContext: () => void
  onShell: () => void
}) {
  return (
    <TooltipV2
      placement="top"
      value={
        <>
          {props.title}
          <KeybindV2 keys={props.keybind ?? []} variant="neutral" />
        </>
      }
    >
      <MenuV2 gutter={6} modal={false} placement="top-start">
        <MenuV2.Trigger
          as={IconButtonV2}
          data-action="prompt-attach"
          type="button"
          icon={<IconV2 name="plus" class="size-5" />}
          variant="ghost-muted"
          size="large"
          class="!size-8 !rounded-lg"
          disabled={props.disabled}
          aria-label={props.title}
        />
        <MenuV2.Portal>
          <MenuV2.Content style={{ "min-width": "180px" }}>
            <MenuV2.Item onSelect={props.onAttach} shortcut={props.attachShortcut}>
              {props.attachLabel}
            </MenuV2.Item>
            <MenuV2.Separator />
            <MenuV2.Item onSelect={props.onCommands} shortcut="/">
              {props.commandsLabel}
            </MenuV2.Item>
            <MenuV2.Item onSelect={props.onContext} shortcut="@">
              {props.contextLabel}
            </MenuV2.Item>
            <MenuV2.Item onSelect={props.onShell} shortcut="!">
              {props.shellLabel}
            </MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </TooltipV2>
  )
}

function PromptInputV2ConfiguredSelect(props: {
  title: string
  keybind?: string[]
  control: PromptInputV2SelectControl
  model?: boolean
}) {
  const current = () => props.control.current()
  const providerID = () => props.control.options().find((option) => option.id === current())?.providerID
  return (
    <PromptInputV2Select
      title={props.title}
      keybind={props.control.keybind?.() ?? props.keybind}
      options={props.control.options()}
      current={current()}
      currentIcon={
        <Show when={props.model && providerID()}>
          <ProviderIcon id={providerID()!} class="size-4 shrink-0 opacity-60" />
        </Show>
      }
      onSelect={props.control.onSelect}
    />
  )
}

export function PromptInputV2Select(props: {
  title: string
  keybind?: string[]
  options: PromptInputV2Option[]
  current: string
  currentIcon?: JSX.Element
  class?: string
  onOpenChange?: (open: boolean) => void
  onSelect: (id: string) => void
}) {
  return (
    <TooltipV2
      placement="top"
      value={
        <>
          {props.title}
          <KeybindV2 keys={props.keybind ?? []} variant="neutral" />
        </>
      }
    >
      <MenuV2 gutter={6} modal={false} placement="top-start" onOpenChange={props.onOpenChange}>
        <MenuV2.Trigger
          as={ButtonV2}
          variant="ghost-muted"
          size="normal"
          class={`max-w-[220px] justify-start ![font-weight:440] ${props.class ?? ""}`}
          aria-label={props.title}
        >
          {props.currentIcon}
          <span class="truncate capitalize leading-5">
            {props.options.find((option) => option.id === props.current)?.label ?? props.current}
          </span>
          <span class="-ms-0.5 -me-1 flex shrink-0">
            <IconV2 name="chevron-down" />
          </span>
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.RadioGroup value={props.current} onChange={props.onSelect}>
              <For each={props.options}>
                {(option) => (
                  <MenuV2.RadioItem value={option.id} class="capitalize" closeOnSelect>
                    {option.label}
                  </MenuV2.RadioItem>
                )}
              </For>
            </MenuV2.RadioGroup>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </TooltipV2>
  )
}

export function PromptInputV2Popover(props: {
  emptyLabel: string
  items: PromptInputV2Suggestion[]
  activeID?: string
  search?: {
    value: string
    label: string
    placeholder: string
    onValueChange: (value: string) => void
    onKeyDown: (event: KeyboardEvent) => void
  }
  onActiveChange: (item: PromptInputV2Suggestion) => void
  onSelect: (item: PromptInputV2Suggestion) => void
}) {
  return (
    <div
      class="absolute inset-x-0 -top-2 z-40 flex max-h-80 -translate-y-full flex-col overflow-auto rounded-xl bg-v2-background-bg-base p-2 shadow-[var(--v2-elevation-raised)] no-scrollbar"
      onMouseDown={(event) => event.preventDefault()}
    >
      <Show when={props.search}>
        {(search) => (
          <div class="px-2 py-1">
            <input
              ref={(element) => requestAnimationFrame(() => element.focus())}
              value={search().value}
              aria-label={search().label}
              placeholder={search().placeholder}
              class="w-full bg-transparent text-[13px] leading-5 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
              onInput={(event) => search().onValueChange(event.currentTarget.value)}
              onKeyDown={(event) => search().onKeyDown(event)}
              onMouseDown={(event) => event.stopPropagation()}
            />
          </div>
        )}
      </Show>
      <Show
        when={props.items.length > 0}
        fallback={<div class="px-2 py-1 text-v2-text-text-muted">{props.emptyLabel}</div>}
      >
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              data-suggestion-id={item.id}
              class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-v2-overlay-simple-overlay-hover"
              classList={{ "bg-v2-overlay-simple-overlay-hover": props.activeID === item.id }}
              onPointerMove={() => props.onActiveChange(item)}
              onClick={() => props.onSelect(item)}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <PromptInputV2SuggestionIcon item={item} />
                <span class="shrink-0 text-v2-text-text-base">{item.label}</span>
                <Show when={item.description}>
                  <span class="min-w-0 truncate text-v2-text-text-muted">{item.description}</span>
                </Show>
              </div>
              <Show when={item.keybind?.length}>
                <span class="shrink-0 text-v2-text-text-muted">{item.keybind?.join("+")}</span>
              </Show>
            </button>
          )}
        </For>
      </Show>
    </div>
  )
}

export function PromptInputV2SubmitButton(props: {
  mode: PromptInputV2Mode
  stopping: boolean
  disabled: boolean
  sendLabel: string
  stopLabel: string
  onSubmit: () => void
  onStop: () => void
}) {
  return (
    <TooltipV2
      placement="top"
      inactive={!props.stopping && props.disabled}
      value={props.stopping ? props.stopLabel : props.sendLabel}
    >
      <button
        data-action="prompt-submit"
        type="button"
        disabled={!props.stopping && props.disabled}
        tabIndex={props.mode === "normal" ? undefined : -1}
        class="composer-send"
        aria-label={props.stopping ? props.stopLabel : props.sendLabel}
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
        <Icon
          name={props.stopping ? "stop" : props.mode === "shell" ? "arrow-undo-down" : "arrow-up"}
          size="small"
        />
      </button>
    </TooltipV2>
  )
}

function PromptInputV2SuggestionIcon(props: { item: PromptInputV2Suggestion }) {
  if (props.item.kind === "agent") return <Icon name="brain" size="small" class="shrink-0 text-weak" />
  if (props.item.kind === "command") return null
  return (
    <FileIcon
      node={{ path: props.item.path ?? props.item.label, type: props.item.kind === "reference" ? "directory" : "file" }}
      class="size-4 shrink-0"
    />
  )
}
