import { createEffect, on, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useFilteredList } from "@kiko/ui/hooks"
import { createPromptInputV2Attachments, type PromptInputV2AttachmentConfig } from "./attachments"
import { createPromptInputV2Store, type PromptInputV2StoreInput } from "./store"
import { composingKey } from "../ime"
import { fileRefToken } from "../rich/file-ref"
import type {
  PromptInputV2Attachment,
  PromptInputV2History,
  PromptInputV2HistoryEntry,
  PromptInputV2Option,
  PromptInputV2PersistedState,
  PromptInputV2Suggestion,
} from "./types"
import {
  createPromptInputV2InteractionState,
  reducePromptInputV2,
  type PromptInputV2InteractionCommand,
  type PromptInputV2InteractionEvent,
} from "./machine"

export type PromptInputV2SelectControl = {
  options: Accessor<PromptInputV2Option[]>
  current: Accessor<string>
  onSelect: (id: string) => void
  keybind?: Accessor<string[]>
}

export type PromptInputV2ViewConfig = {
  placeholder?: Accessor<string>
  add?: {
    onAttach: () => void
  }
  agent?: PromptInputV2SelectControl
  model?: PromptInputV2SelectControl
  variant?: PromptInputV2SelectControl
  submit: {
    canSubmit?: Accessor<boolean | undefined>
    /** Attachments are still being read for sending. The send button says so. */
    preparing?: Accessor<boolean>
    /** Why sending waits, such as an attachment still uploading. The send button is off and says so. */
    blocked?: Accessor<string | null>
    onSubmit: () => void
  }
  shell?: {
    onOpen: () => void
    onClose: () => void
  }
  onKeyDown?: (event: KeyboardEvent) => void
  onPaste?: (event: ClipboardEvent) => void
}

export type PromptInputV2Rich = {
  insertText: (text: string) => void
  insertMention: (slug: string) => void
  insertAttachments: (items: readonly { id: string; name: string }[], at?: { x: number; y: number }) => void
  insertFileRefs: (paths: readonly string[], at?: { x: number; y: number }) => void
  removeAttachment: (id: string) => void
}

export function createPromptInputV2State() {
  return createStore(createPromptInputV2InteractionState())
}

export function createPromptInputV2Controller(input: {
  store: PromptInputV2StoreInput
  state?: ReturnType<typeof createPromptInputV2State>
  identity?: Accessor<unknown>
  history?: PromptInputV2History
  commands: Accessor<PromptInputV2Suggestion[]>
  context: Accessor<PromptInputV2Suggestion[]>
  searchContextFiles: (query: string) => PromptInputV2Suggestion[] | Promise<PromptInputV2Suggestion[]>
  openAttachment?: (attachment: PromptInputV2Attachment) => void
  onEditor?: (element: HTMLElement) => void
  onSuggestionSelect?: (item: PromptInputV2Suggestion) => (() => void) | void
  view: PromptInputV2ViewConfig
  attachments?: PromptInputV2AttachmentConfig
}) {
  let editor: HTMLElement | undefined
  let rich: PromptInputV2Rich | undefined
  let fileInput: HTMLInputElement | undefined
  const draft = createPromptInputV2Store(input.store)
  const [state, setState] = input.state ?? createPromptInputV2State()
  if (input.identity) {
    createEffect(on(input.identity, () => setState(reconcile(createPromptInputV2InteractionState())), { defer: true }))
  }
  function addPart(part: PromptInputV2PersistedState["prompt"][number]) {
    if (part.type === "image") return false
    if (rich) {
      rich.insertText(part.type === "text" ? part.content : `${part.content} `)
      return true
    }
    if (part.type === "file" || part.type === "agent") {
      draft.addMention(part)
      return true
    }
    draft.addText(part.content)
    return true
  }
  const attachments = input.attachments
    ? createPromptInputV2Attachments({
        ...input.attachments,
        capture: () => ({
          current: () => draft.state.prompt,
          cursor: () => draft.state.cursor,
          set: draft.setPrompt,
        }),
        editor: () => editor,
        focusEditor: () => editor?.focus(),
        addPart,
        chip: (items, at) => rich?.insertAttachments(items, at),
        fileRef: (paths, at) => {
          if (rich) rich.insertFileRefs(paths, at)
          else for (const path of paths) addPart({ type: "text", content: `${fileRefToken(path, path.endsWith("/"))} `, start: 0, end: 0 })
        },
        hasText: () => draft.state.prompt.some((part) => part.type === "text" && part.content.trim() !== ""),
        setDragging: (dragging) => {
          if ((state.drag === "active") !== dragging) dispatch({ type: dragging ? "drag.enter" : "drag.leave" })
        },
      })
    : undefined
  const attach = () => {
    if (!attachments) {
      input.view.add?.onAttach()
      return
    }
    fileInput?.click()
  }
  const contextList = useFilteredList<PromptInputV2Suggestion>({
    items: async (query) => {
      const fixed = input.context().filter((item) => item.kind !== "file")
      const recent = input.context().filter((item) => item.kind === "file" && item.recent)
      if (!query.trim()) return [...fixed, ...recent]
      const seen = new Set(recent.map((item) => item.id))
      const files = (await input.searchContextFiles(query)).filter((item) => !seen.has(item.id))
      return [...fixed, ...recent, ...files]
    },
    key: (item) => item.id,
    filterKeys: ["label"],
    skipFilter: (item) => item.kind === "file" && !item.recent,
    groupBy: (item) => {
      if (item.kind === "reference") return "reference"
      if (item.kind === "agent") return "agent"
      if (item.kind === "resource") return "resource"
      if (item.recent) return "recent"
      return "file"
    },
    sortGroupsBy: (a, b) => {
      const order = ["reference", "agent", "resource", "recent", "file"]
      return order.indexOf(a.category) - order.indexOf(b.category)
    },
  })
  const commandList = useFilteredList<PromptInputV2Suggestion>({
    items: () => input.commands(),
    key: (item) => item.id,
    filterKeys: ["trigger", "title"],
  })
  const list = () => (state.popover.type === "context" ? contextList : commandList)
  const suggestions = () => list().flat()

  const execute = (command: PromptInputV2InteractionCommand) => {
    if (command.type === "draft.setText") {
      draft.setText(command.value)
      return
    }
    if (command.type === "mention.add") {
      const mention = command.item.mention
      if (!mention) return
      if (!rich) draft.addMention(mention)
      else if (mention.type === "agent") rich.insertMention(mention.name)
      else rich.insertText(`${mention.content} `)
      return
    }
    if (command.type === "popover.filter") {
      ;(command.popover === "command" ? commandList : contextList).onInput(command.query)
      return
    }
    if (command.type === "suggestion.select") {
      const item = suggestions().find((entry) => entry.id === command.id)
      if (item) dispatch({ type: "popover.select", item })
      return
    }
    if (command.type === "focus.editor") requestAnimationFrame(() => editor?.focus())
  }

  function dispatch(event: PromptInputV2InteractionEvent) {
    const mode = state.mode
    const result = reducePromptInputV2(state, event, draft.state)
    const action = event.type === "popover.select" ? input.onSuggestionSelect?.(event.item) : undefined
    if (event.type === "popover.select") {
      if (!action || state.popover.type !== "command-menu") result.commands.forEach(execute)
      if (action && event.item.kind === "command" && state.popover.type !== "command-menu") {
        draft.setPrompt(
          draft.state.prompt.filter((part): part is PromptInputV2Attachment => part.type === "image"),
          0,
        )
      }
    }
    setState(reconcile(result.state))
    if (event.type !== "popover.select") result.commands.forEach(execute)
    if (mode !== result.state.mode) {
      if (result.state.mode === "shell") input.view.shell?.onOpen()
      if (result.state.mode === "normal") input.view.shell?.onClose()
    }
    if (event.type === "popover.select") {
      if (!action) return result.handled
      action()
    }
    return result.handled
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      state.mode === "normal" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "u"
    ) {
      event.preventDefault()
      attach()
      return true
    }
    const handled = dispatch({
      type: "key.down",
      key: event.key,
      ctrl: event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey,
      composing: composingKey(event),
      ids: suggestions().map((item) => item.id),
      empty: draft.state.prompt.every((part) => !("content" in part) || part.content.length === 0),
    })
    if (handled) event.preventDefault()
    if (handled && event.key !== "Enter" && event.key !== "Tab" && state.popover.type !== "closed") {
      const activeID = state.popover.activeID ?? ""
      requestAnimationFrame(() =>
        document.querySelector(`[data-suggestion-id="${CSS.escape(activeID)}"]`)?.scrollIntoView({ block: "nearest" }),
      )
    }
    if (handled) return true
    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      navigateHistory(event.key === "ArrowUp" ? "up" : "down")
    ) {
      event.preventDefault()
      return true
    }
    input.view.onKeyDown?.(event)
    return event.defaultPrevented
  }

  createEffect(() => {
    if (state.popover.type === "closed") return
    const ids = suggestions().map((item) => item.id)
    if (state.popover.activeID ? ids.includes(state.popover.activeID) : ids.length === 0) return
    dispatch({ type: "popover.results", ids })
  })

  const restoreFocus = (cursor = draft.state.cursor ?? promptLength(draft.state.prompt)) => {
    requestAnimationFrame(() => {
      editor?.focus()
      setEditorCursor(editor, cursor)
    })
  }

  const applyHistory = (entry: PromptInputV2HistoryEntry, position: "start" | "end") => {
    input.history?.restore?.(entry.metadata)
    const cursor = position === "start" ? 0 : promptLength(entry.prompt)
    draft.setPrompt(clonePrompt(entry.prompt), cursor)
    restoreFocus(cursor)
  }
  const navigateHistory = (direction: "up" | "down") => {
    if (!input.history || !editor) return false
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !editor.contains(selection.anchorNode)) return false
    // The caret is measured in rendered text, so the length is too. A formatted draft's markdown is longer.
    const length = editor.textContent?.length ?? 0
    if (!canNavigateHistory(direction, length, editorCursor(editor), state.historyIndex >= 0)) return false
    const entries = input.history.entries(state.mode)
    if (direction === "up") {
      if (entries.length === 0 || state.historyIndex >= entries.length - 1) return false
      if (state.historyIndex === -1) {
        setState("savedHistory", {
          prompt: clonePrompt(draft.state.prompt),
          metadata: input.history.capture?.(),
        })
      }
      const index = state.historyIndex + 1
      setState("historyIndex", index)
      applyHistory(entries[index]!, "start")
      return true
    }
    if (state.historyIndex < 0) return false
    if (state.historyIndex > 0) {
      const index = state.historyIndex - 1
      setState("historyIndex", index)
      applyHistory(entries[index]!, "end")
      return true
    }
    const saved = state.savedHistory ?? { prompt: [{ type: "text", content: "", start: 0, end: 0 }] }
    setState({ historyIndex: -1, savedHistory: undefined })
    applyHistory(saved, "end")
    return true
  }

  return {
    state,
    view: input.view,
    suggestions,
    dispatch,
    onKeyDown,
    value() {
      return draft.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")
    },
    parts() {
      return draft.state.prompt
    },
    addPart,
    attachments(): PromptInputV2Attachment[] {
      return draft.state.prompt.filter((part): part is PromptInputV2Attachment => part.type === "image")
    },
    importAttachments(files: readonly { attachment: PromptInputV2Attachment; file: File }[]) {
      const replacements = new Map<string, string>()
      if (input.attachments?.blocked?.()) return replacements
      const held = new Set(draft.state.prompt.filter((part) => part.type === "image").map((part) => part.id))
      const imported = files.filter(({ attachment }) => !held.has(attachment.id)).map(({ attachment, file }) => {
        const id = crypto.randomUUID()
        replacements.set(attachment.id, id)
        const part = { ...attachment, id, blob: { ...attachment.blob, url: URL.createObjectURL(file) } }
        input.attachments?.onAdded?.(part, file)
        return part
      })
      if (imported.length) draft.setPrompt([...draft.state.prompt, ...imported], draft.state.cursor)
      return replacements
    },
    openAttachment(attachment: PromptInputV2Attachment) {
      input.openAttachment?.(attachment)
    },
    removeAttachment(id: string) {
      draft.removeAttachment(id)
      rich?.removeAttachment(id)
    },
    canSubmit() {
      if (input.view.submit.blocked?.()) return false
      const pending = input.view.submit.canSubmit?.()
      if (pending !== undefined) return pending
      const persisted = draft.state
      if (persisted.prompt.some((part) => part.type === "image")) return true
      return persisted.prompt.some((part) => "content" in part && !!part.content.trim())
    },
    setEditor(element: HTMLElement) {
      editor = element
      input.onEditor?.(element)
    },
    setRich(handle: PromptInputV2Rich | undefined) {
      rich = handle
    },
    restoreFocus,
    onInput(value: string, prompt?: PromptInputV2PersistedState["prompt"], cursor?: number) {
      if (prompt) draft.setPrompt(prompt, cursor)
      dispatch({ type: "input.changed", value, persist: !prompt })
    },
    onCursor(cursor: number) {
      draft.setCursor(cursor)
    },
    openCommands() {
      dispatch({ type: "commands.open" })
    },
    agents: () => input.context().filter((item) => item.kind === "agent"),
    mention(item: PromptInputV2Suggestion) {
      dispatch({ type: "popover.select", item })
    },
    openContext() {
      dispatch({ type: "context.open" })
    },
    openShell() {
      dispatch({ type: "mode.shell" })
    },
    closeShell() {
      dispatch({ type: "mode.normal" })
    },
    submit() {
      input.view.submit.onSubmit()
      dispatch({ type: "popover.close" })
    },
    addHistory(prompt: PromptInputV2PersistedState["prompt"], mode: "normal" | "shell") {
      input.history?.add(prompt, mode)
      setState({ historyIndex: -1, savedHistory: undefined })
    },
    resetHistory() {
      setState({ historyIndex: -1, savedHistory: undefined })
    },
    onPaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      if (
        attachments &&
        (Array.from(clipboard?.items ?? []).some((item) => item.kind === "file") || !clipboard?.getData("text/plain"))
      ) {
        void attachments.handlePaste(event)
        return
      }
      input.view.onPaste?.(event)
      if (event.defaultPrevented) return
      const text = clipboard?.getData("text/plain")
      if (!text) return
      event.preventDefault()
      if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return
      const target = event.currentTarget
      const selection = window.getSelection()
      if (!(target instanceof HTMLElement) || !selection?.rangeCount || !target.contains(selection.anchorNode)) return
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }))
    },
    attach,
    setFileInput(element: HTMLInputElement) {
      fileInput = element
    },
    dragKind: () => attachments?.dragKind() ?? "files",
    addAttachments(files: File[]) {
      if (attachments) void attachments.addAttachments(files)
    },
    setQuery(value: string) {
      dispatch({ type: "popover.query", value })
    },
  }
}

export type PromptInputV2Interaction = ReturnType<typeof createPromptInputV2Controller>

function canNavigateHistory(direction: "up" | "down", length: number, cursor: number, inHistory: boolean) {
  const position = Math.max(0, Math.min(cursor, length))
  if (inHistory) return position === 0 || position === length
  if (direction === "up") return position === 0 && length === 0
  return position === length
}

function clonePrompt(prompt: PromptInputV2PersistedState["prompt"]): PromptInputV2PersistedState["prompt"] {
  return prompt.map((part) =>
    part.type === "file" ? { ...part, selection: part.selection ? { ...part.selection } : undefined } : { ...part },
  )
}

function promptLength(prompt: PromptInputV2PersistedState["prompt"]) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}

function editorCursor(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return editor.textContent?.length ?? 0
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  range.setEnd(selection.anchorNode!, selection.anchorOffset)
  return range.toString().length
}

function setEditorCursor(editor: HTMLElement | undefined, cursor: number) {
  if (!editor) return
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let remaining = cursor
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= length
    node = walker.nextNode()
  }
}
