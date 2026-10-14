import { createEffect, on, onCleanup } from "solid-js"
import type { PromptInputV2Interaction } from "../prompt-input/interaction"
import type { PromptInputV2Attachment } from "../prompt-input/types"
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
      editor.setMarkdown(text)
      input.onEdit()
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
