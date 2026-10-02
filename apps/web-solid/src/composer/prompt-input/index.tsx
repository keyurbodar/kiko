import { createEffect, createSignal, For, lazy, onMount, Show, Suspense, type JSX } from "solid-js"
import { Icon } from "@kiko/ui/icon"
import { ProviderIcon } from "@kiko/ui/provider-icon"
import { useI18n } from "@kiko/ui/context/i18n"
import { ButtonV2 } from "@kiko/ui/v2/button-v2"
import { Icon as IconV2 } from "@kiko/ui/v2/icon"
import { IconButtonV2 } from "@kiko/ui/v2/icon-button-v2"
import { KeybindV2 } from "@kiko/ui/v2/keybind-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { identityLook } from "../../lib/identity"
import type {
  PromptInputV2Attachment,
  PromptInputV2Option,
  PromptInputV2PersistedState,
  PromptInputV2Prompt,
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

  // The first attachment or popover should not wait on the network.
  onMount(() => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => void extras(), { timeout: 2000 })
    else setTimeout(() => void extras(), 300)
  })

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
        <Show
          when={
            state.mode === "normal" &&
            (props.controller.attachments().length > 0 || props.controller.comments().length > 0)
          }
        >
          <Suspense>
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
          </Suspense>
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
