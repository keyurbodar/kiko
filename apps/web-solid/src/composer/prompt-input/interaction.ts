import { createEffect, createMemo, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { attachmentError, attachmentMessages, MAX_ATTACHMENTS } from "@kiko/protocol"
import { createPromptInputV2Attachments, type PromptInputV2AttachmentConfig } from "./attachments"
import { createPromptInputV2Store, type PromptInputV2StoreInput } from "./store"
import { composingKey } from "../ime"
import { attachmentToken } from "@kiko/protocol"
import { fileRefToken } from "../rich/file-ref"
import { trayAttachments } from "./placement"
import { tokenText, type Token, type TokenGroup, type Trigger } from "../tokens"
import type { PromptInputV2Attachment, PromptInputV2PersistedState } from "./types"
import {
  createPromptInputV2InteractionState,
  reducePromptInputV2,
  type PromptInputV2InteractionCommand,
  type PromptInputV2InteractionEvent,
} from "./machine"

export type PromptInputV2ViewConfig = {
  submit: {
    canSubmit?: Accessor<boolean | undefined>
    preparing?: Accessor<boolean>
    blocked?: Accessor<string | null>
    onSubmit: () => void
  }
  onPaste?: (event: ClipboardEvent) => void
}

export type PromptInputV2Rich = {
  insertText: (text: string) => void
  insertToken: (trigger: Trigger, token: Token) => void
  insertFileRefs: (paths: readonly string[], at?: { x: number; y: number }) => void
  insertAttachments: (items: readonly { id: string; name: string }[], at?: { x: number; y: number }) => void
  removeAttachment: (id: string) => void
}

export function createPromptInputV2Controller(input: {
  store: PromptInputV2StoreInput
  tokens: (trigger: Trigger, query: string, atStart: boolean) => TokenGroup[]
  agents: Accessor<readonly Token[]>
  openAttachment?: (attachment: PromptInputV2Attachment) => void
  view: PromptInputV2ViewConfig
  attachments?: PromptInputV2AttachmentConfig
  onAction?: (item: Token) => void
}) {
  let editor: HTMLElement | undefined
  let rich: PromptInputV2Rich | undefined
  let fileInput: HTMLInputElement | undefined
  const draft = createPromptInputV2Store(input.store)
  const [state, setState] = createStore(createPromptInputV2InteractionState())
  const plainText = () => draft.state.prompt.map((part) => (part.type === "text" ? part.content : "")).join("")
  function addPart(part: PromptInputV2PersistedState["prompt"][number]) {
    if (part.type === "image") return false
    if (rich) {
      rich.insertText(part.type === "text" ? part.content : `${part.content} `)
      return true
    }
    draft.addText(part.content)
    return true
  }
  function insertFileRefs(paths: readonly string[], at?: { x: number; y: number }) {
    if (rich) return rich.insertFileRefs(paths, at)
    for (const path of paths)
      addPart({ type: "text", content: `${fileRefToken(path, path.endsWith("/"))} `, start: 0, end: 0 })
  }
  function insertAttachments(items: readonly { id: string; name: string }[], at?: { x: number; y: number }) {
    if (rich) return rich.insertAttachments(items, at)
    for (const item of items)
      addPart({ type: "text", content: `${attachmentToken(item.id, item.name)} `, start: 0, end: 0 })
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
        fileRef: insertFileRefs,
        chip: insertAttachments,
        setDragging: (dragging) => {
          if ((state.drag === "active") !== dragging) dispatch({ type: dragging ? "drag.enter" : "drag.leave" })
        },
      })
    : undefined
  const groups = createMemo((): TokenGroup[] => {
    const popover = state.popover
    return popover.type === "open" ? input.tokens(popover.trigger, popover.query, popover.atStart) : []
  })
  const suggestions = createMemo(() => groups().flatMap((group) => group.items))

  const insert = (trigger: Trigger, item: Token) => {
    if (item.kind === "action") {
      const text = plainText()
      const cursor = draft.state.cursor ?? text.length
      const at = text.lastIndexOf(trigger, cursor)
      draft.setText(at < 0 ? text : `${text.slice(0, at)}${text.slice(cursor)}`)
      input.onAction?.(item)
      return
    }
    if (item.kind === "command") {
      const text = plainText()
      const at = trigger === "/" ? text.lastIndexOf("/", draft.state.cursor ?? text.length) : -1
      draft.setText(`${at < 0 ? text : text.slice(0, at)}/${item.trigger} `)
      return
    }
    if (rich) return rich.insertToken(trigger, item)
    const text = plainText()
    const cursor = draft.state.cursor ?? text.length
    const at = text.lastIndexOf(trigger, cursor)
    draft.setText(`${text.slice(0, at < 0 ? cursor : at)}${tokenText(item)} ${text.slice(cursor)}`)
  }

  const execute = (command: PromptInputV2InteractionCommand) => {
    if (command.type === "token.insert") return insert(command.trigger, command.item)
    if (command.type === "suggestion.select") {
      const item = suggestions().find((entry) => entry.id === command.id)
      if (item) dispatch({ type: "popover.select", item })
      return
    }
    requestAnimationFrame(() => editor?.focus())
  }

  function dispatch(event: PromptInputV2InteractionEvent) {
    const result = reducePromptInputV2(state, event)
    setState(reconcile(result.state))
    result.commands.forEach(execute)
    return result.handled
  }

  const insertToken = (item: Token) => {
    dispatch({ type: "popover.close" })
    if (rich) rich.insertToken("@", item)
    else insert("@", item)
    requestAnimationFrame(() => editor?.focus())
  }

  const attach = () => fileInput?.click()

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      attach()
      return true
    }
    if (suggestions().length === 0) return false
    const handled = dispatch({
      type: "key.down",
      key: event.key,
      ctrl: event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey,
      composing: composingKey(event),
      ids: suggestions().map((item) => item.id),
    })
    if (!handled) return false
    event.preventDefault()
    if (event.key !== "Enter" && event.key !== "Tab" && state.popover.type === "open") {
      const activeID = state.popover.activeID ?? ""
      requestAnimationFrame(() =>
        document.querySelector(`[data-suggestion-id="${CSS.escape(activeID)}"]`)?.scrollIntoView({ block: "nearest" }),
      )
    }
    return true
  }

  createEffect(() => {
    if (state.popover.type === "closed") return
    const ids = suggestions().map((item) => item.id)
    if (state.popover.activeID ? ids.includes(state.popover.activeID) : ids.length === 0) return
    dispatch({ type: "popover.results", ids })
  })

  return {
    state,
    view: input.view,
    groups,
    suggestions,
    dispatch,
    onKeyDown,
    parts() {
      return draft.state.prompt
    },
    addPart,
    insertFileRefs,
    attachments(): PromptInputV2Attachment[] {
      return draft.state.prompt.filter((part): part is PromptInputV2Attachment => part.type === "image")
    },
    trayAttachments(): PromptInputV2Attachment[] {
      return trayAttachments(draft.state.prompt)
    },
    importAttachments(files: readonly { attachment: PromptInputV2Attachment; file: File }[]) {
      const replacements = new Map<string, string>()
      if (input.attachments?.blocked?.()) return replacements
      const held = draft.state.prompt.filter((part): part is PromptInputV2Attachment => part.type === "image")
      const imported: PromptInputV2Attachment[] = []
      for (const { attachment, file } of files) {
        const existing = [...held, ...imported].find(
          (part) => part.id === attachment.id || part.blob.id === attachment.blob.id,
        )
        if (existing) {
          replacements.set(attachment.id, existing.id)
          continue
        }
        const refusal =
          held.length + imported.length >= MAX_ATTACHMENTS ? attachmentMessages.tooMany : attachmentError(file)
        if (refusal) {
          input.attachments?.refuse([{ name: file.name, reason: refusal }])
          continue
        }
        const id = crypto.randomUUID()
        replacements.set(attachment.id, id)
        const part = { ...attachment, id, blob: { ...attachment.blob, url: URL.createObjectURL(file) } }
        input.attachments?.onAdded?.(part, file)
        imported.push(part)
      }
      if (imported.length) draft.setPrompt([...draft.state.prompt, ...imported], draft.state.cursor)
      return replacements
    },
    openAttachment(attachment: PromptInputV2Attachment) {
      input.openAttachment?.(attachment)
    },
    removeAttachment(id: string) {
      if (rich) return rich.removeAttachment(id)
      draft.removeAttachment(id)
    },
    canSubmit() {
      if (input.view.submit.blocked?.()) return false
      const pending = input.view.submit.canSubmit?.()
      if (pending !== undefined) return pending
      const persisted = draft.state
      if (trayAttachments(persisted.prompt).length > 0) return true
      return persisted.prompt.some((part) => "content" in part && !!part.content.trim())
    },
    setEditor(element: HTMLElement) {
      editor = element
    },
    setRich(handle: PromptInputV2Rich | undefined) {
      rich = handle
    },
    onInput(value: string, prompt: PromptInputV2PersistedState["prompt"], cursor: number) {
      draft.setPrompt(prompt, cursor)
      dispatch({ type: "input.changed", value, cursor })
    },
    onCursor(value: string, cursor: number) {
      draft.setCursor(cursor)
      if (state.popover.type === "open") dispatch({ type: "input.changed", value, cursor })
    },
    agents: input.agents,
    insertToken,
    mention: insertToken,
    submit() {
      input.view.submit.onSubmit()
      dispatch({ type: "popover.close" })
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
  }
}

export type PromptInputV2Interaction = ReturnType<typeof createPromptInputV2Controller>
