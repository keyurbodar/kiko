import { createEffect, on, onCleanup } from "solid-js"
import type { PromptInputV2Interaction } from "../prompt-input/interaction"
import type { PromptInputV2Attachment } from "../prompt-input/types"
import { composingKey, enterIsNewline } from "../ime"
import { chipView, type ChipSource, fileRefView, tokenView } from "../prompt-input/chip"
import { PASTED_TEXT } from "../prompt-input/tray"
import { pastedComposerFragment, prepareClipboardFiles } from "./clipboard"
import { mountRichEditor, type RichEditor } from "./editor"
import type { ParseOptions } from "./markdown"
import type { Token } from "../tokens"

function tokenNode(token: Token): { type: string; attrs: Record<string, unknown> } {
  if (token.kind === "agent" || token.kind === "app") return { type: "mention", attrs: { slug: token.slug } }
  if (token.kind === "file") return { type: "fileRef", attrs: { path: token.path } }
  if (token.kind === "command") return { type: "slash", attrs: { name: token.trigger } }
  return { type: "slash", attrs: { name: token.name } }
}

const LONG_PASTE = 1500
const LONE_URL = /^https?:\/\/[^\s<>()[\]]+$/

function linkChip(text: string): string {
  const url = text.trim()
  if (!LONE_URL.test(url)) return text
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.split("/").find(Boolean)
    const label = `${parsed.hostname.replace(/^www\./, "")}${path ? `/${path}` : ""}`
    return `[${label.length > 40 ? `${label.slice(0, 39)}…` : label}](${url})`
  } catch {
    return text
  }
}

export type RichBinding = {
  editor: RichEditor
  destroy: () => void
}

export function bindRich(input: {
  host: HTMLElement
  controller: PromptInputV2Interaction
  label: string
  parse: ParseOptions
  chips: Omit<ChipSource, "attachments" | "openAttachment">
  disabled: () => boolean
  shortcodes: { sync: () => void; onKeyDown: (event: KeyboardEvent) => boolean; close: () => void }
  onEdit: () => void
  onFocus: () => void
}): RichBinding {
  const { controller } = input
  const markdown = () =>
    controller
      .parts()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")

  const source: ChipSource = {
    ...input.chips,
    attachments: controller.attachments,
    openAttachment: controller.openAttachment,
  }
  const editor = mountRichEditor({
    element: input.host,
    markdown: markdown(),
    label: input.label,
    parse: input.parse,
    token: tokenView(source),
    chip: chipView(source),
    fileRef: fileRefView(source),
    onChange: ({ markdown: text, plain, cursor }) => {
      const images: PromptInputV2Attachment[] = controller.attachments()
      controller.onInput(plain, [{ type: "text", content: text, start: 0, end: text.length }, ...images], cursor)
      input.onEdit()
      input.shortcodes.sync()
    },
    onCursor: (cursor, plain) => {
      controller.onCursor(plain, cursor)
      input.shortcodes.sync()
    },
    onKeyDown: (event) => {
      if (input.shortcodes.onKeyDown(event)) return true
      if (controller.onKeyDown(event)) return true
      if (event.key !== "Enter" || composingKey(event) || event.shiftKey || event.altKey || enterIsNewline(event))
        return false
      const modified = event.metaKey || event.ctrlKey
      if (!modified && editor.inCode()) return false
      event.preventDefault()
      if (!event.repeat) controller.submit()
      return true
    },
    pastedText: (clipboard) => {
      const fragment = pastedComposerFragment(clipboard)
      if (!fragment)
        return editor.inCode() ? clipboard.getData("text/plain") : linkChip(clipboard.getData("text/plain"))
      const replacements = controller.importAttachments(fragment.files)
      return fragment.markdown.replace(/!?\[[^\]\n]*\]\(attachment:([\w-]+)\)/g, (token, id: string) => {
        const target = replacements.get(id) ?? id
        return controller.attachments().some((attachment) => attachment.id === target)
          ? token.replace(`(attachment:${id})`, `(attachment:${target})`)
          : ""
      })
    },
    onPaste: (event) => {
      const clipboard = event.clipboardData
      const files = Array.from(clipboard?.items ?? []).some((item) => item.kind === "file")
      const text = clipboard?.getData("text/plain") ?? ""
      if (!files && text.length > LONG_PASTE && !editor.inCode() && !pastedComposerFragment(clipboard!)) {
        event.preventDefault()
        controller.addAttachments([new File([text], PASTED_TEXT, { type: "text/plain" })])
        return true
      }
      if (!files && text) return false
      controller.onPaste(event)
      return true
    },
    onFocus: input.onFocus,
    onBlur: input.shortcodes.close,
  })

  controller.setEditor(editor.dom)
  controller.setRich({
    insertText: (text) => editor.insertText(text),
    insertToken: (trigger, token) => editor.insertToken(trigger, tokenNode(token)),
    insertFileRefs: (paths, at) => editor.insertFileRefs(paths, at),
    removeAttachment: (id) => editor.removeAttachment(id),
  })

  createEffect(() => prepareClipboardFiles(controller.attachments()))

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
