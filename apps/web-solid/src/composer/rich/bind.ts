import { createEffect, on, onCleanup } from "solid-js"
import { progressLabel, retryUpload, uploadState } from "../../sync/uploads"
import type { PromptInputV2Interaction } from "../prompt-input/interaction"
import type { PromptInputV2Attachment } from "../prompt-input/types"
import { isImage } from "../../lib/attachments"
import { composingKey, enterIsNewline } from "../ime"
import { mountRichEditor, type RichEditor } from "./editor"

export type RichBinding = {
  editor: RichEditor
  destroy: () => void
}

export function bindRich(input: {
  host: HTMLElement
  controller: PromptInputV2Interaction
  label: string
  isMention: (slug: string) => boolean
  disabled: () => boolean
  shortcodes: { sync: () => void; onKeyDown: (event: KeyboardEvent) => boolean; close: () => void }
  onEdit: () => void
  onLink: (href: string | null) => void
  onFocus: () => void
}): RichBinding {
  const { controller } = input
  const markdown = () =>
    controller
      .parts()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
  const chipsOf = () => controller.attachments().filter((a) => !isImage({ name: a.filename, type: a.mime }))
  const placed = new Set<string>()

  const editor = mountRichEditor({
    element: input.host,
    markdown: markdown(),
    label: input.label,
    isMention: input.isMention,
    onChange: ({ markdown: text, plain, cursor }) => {
      const images: PromptInputV2Attachment[] = controller.attachments()
      controller.onInput(plain, [{ type: "text", content: text, start: 0, end: text.length }, ...images], cursor)
      input.onEdit()
      input.shortcodes.sync()
    },
    onCursor: (cursor) => {
      controller.onCursor(cursor)
      input.shortcodes.sync()
    },
    onChips: (ids) => {
      const now = new Set(ids)
      for (const attachment of chipsOf()) if (placed.has(attachment.id) && !now.has(attachment.id)) controller.removeAttachment(attachment.id)
    },
    onKeyDown: (event) => {
      if (input.shortcodes.onKeyDown(event)) return true
      if (controller.onKeyDown(event)) return true
      if (event.key !== "Enter" || composingKey(event) || event.shiftKey || event.altKey || enterIsNewline(event)) return false
      const modified = event.metaKey || event.ctrlKey
      if (!modified && editor.inCode()) return false
      event.preventDefault()
      if (!event.repeat) controller.submit()
      return true
    },
    onPaste: (event) => {
      const clipboard = event.clipboardData
      const files = Array.from(clipboard?.items ?? []).some((item) => item.kind === "file")
      if (!files && clipboard?.getData("text/plain")) return false
      controller.onPaste(event)
      return true
    },
    onLink: input.onLink,
    onChipAction: (id) => retryUpload(id),
    onChipRemove: (id) => controller.removeAttachment(id),
    onFocus: () => {
      controller.dispatch({ type: "focus.editor" })
      input.onFocus()
    },
    onBlur: input.shortcodes.close,
  })

  controller.setEditor(editor.dom)
  controller.setRich({
    insertText: (text) => editor.insertText(text),
    insertMention: (slug) => editor.insertMention(slug),
  })

  createEffect(() => {
    const text = markdown()
    if (text !== editor.snapshot().markdown) {
      placed.clear()
      editor.setMarkdown(text)
      input.onEdit()
    }
    editor.keepChips(new Set(chipsOf().map((attachment) => attachment.id)))
    const present = new Set(editor.chips())
    for (const attachment of chipsOf()) {
      if (!present.has(attachment.id)) editor.addChip({ id: attachment.id, name: attachment.filename })
      placed.add(attachment.id)
    }
  })

  createEffect(() => {
    for (const attachment of chipsOf()) {
      const upload = uploadState(attachment.id)
      if (upload?.status === "failed") editor.chipStatus(attachment.id, { state: "failed", reason: upload.reason })
      else if (upload?.status === "uploading") editor.chipStatus(attachment.id, { state: "uploading", label: progressLabel(upload.progress) })
      else editor.chipStatus(attachment.id, { state: "ready" })
    }
  })

  createEffect(() => {
    const editable = !input.disabled()
    if (editable !== editor.isEditable()) editor.setEditable(editable)
  })

  createEffect(
    on(
      () => controller.attachments().length,
      () => queueMicrotask(input.onEdit),
    ),
  )

  const destroy = () => {
    controller.setRich(undefined)
    editor.destroy()
  }
  onCleanup(destroy)
  return { editor, destroy }
}
