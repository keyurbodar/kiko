import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { MAX_IMAGE_BYTES, attachmentMessages } from "@yuki/protocol"
import { admit, attachmentType } from "../../lib/attachments"
import { prepareImageForAttachment } from "../../lib/image-compression"
import type { PromptInputV2Attachment, PromptInputV2Prompt } from "./types"

/*
 * Files into the composer: the attach button's picker, a paste, and a drop anywhere on the page,
 * decided the way t3code's composer decides (`lib/attachments.ts` holds the rules). A picture over
 * 10 MB is shrunk to fit; a picture yuki cannot send, an empty file, a file over 50 MB, and a file
 * past the 100th are refused, and the last refusal is said in a toast. Each file taken starts
 * uploading at once (`onAdded`), so it is usually on the server before the human presses send.
 */

type PromptTarget = {
  current: () => PromptInputV2Prompt
  cursor: () => number | undefined
  set: (prompt: PromptInputV2Prompt, cursor?: number) => void
}

export type PromptInputV2AttachmentConfig = {
  /** Says why files were left out: too large, the wrong kind, or past the count. */
  refuse: (reasons: string[]) => void
  /** A file entered the box, as `file` (a picture possibly re-encoded). Its upload starts here. */
  onAdded?: (attachment: PromptInputV2Attachment, file: File) => void
}

export function createPromptInputV2Attachments(
  input: PromptInputV2AttachmentConfig & {
    capture: () => PromptTarget
    editor: () => HTMLElement | undefined
    focusEditor: () => void
    addPart: (part: PromptInputV2Prompt[number]) => boolean
    setDragging: (dragging: boolean) => void
  },
) {
  const capture = (): PromptTarget => {
    const prompt = input.capture()
    const editor = input.editor()
    return { ...prompt, cursor: () => prompt.cursor() ?? (editor ? cursorPosition(editor) : undefined) }
  }
  const addAttachments = async (files: File[], target = capture()) => {
    const held = target.current().filter((part) => part.type === "image")
    const { images, files: others, error } = admit(held.length, files)
    const refusals = error ? [error] : []
    const added: PromptInputV2Attachment[] = []
    const take = async (file: File) => {
      const id = await blobId(file)
      // The same bytes twice, as a double paste makes, are attached once.
      if ([...held, ...added].some((part) => part.blob.id === id)) return
      const attachment: PromptInputV2Attachment = {
        type: "image",
        id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2),
        filename: file.name || "file",
        mime: attachmentType(file),
        size: file.size,
        blob: { id, url: URL.createObjectURL(file) },
      }
      added.push(attachment)
      input.onAdded?.(attachment, file)
    }
    for (const file of others) await take(file)
    for (const file of images) {
      // Pictures over the limit are shrunk rather than refused; one within it passes byte for byte.
      const typed = file.type === attachmentType(file) ? file : new File([file], file.name, { type: attachmentType(file), lastModified: file.lastModified })
      const prepared = await prepareImageForAttachment(typed, MAX_IMAGE_BYTES)
      if (prepared.ok) await take(prepared.file)
      else refusals.push(prepared.reason === "unreadable" ? attachmentMessages.unreadable(file.name) : attachmentMessages.tooLargeCompressed(file.name))
    }
    if (refusals.length) input.refuse([refusals.at(-1)!])
    if (added.length) target.set([...target.current(), ...added], target.cursor())
  }
  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return
    const target = capture()
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })
    if (files.length > 0) return addAttachments(files, target)
    const plainText = clipboardData.getData("text/plain") ?? ""
    if (!plainText) return
    const text = plainText.includes("\r") ? plainText.replace(/\r\n?/g, "\n") : plainText
    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor()
      return input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }
    if (text.includes("\n") || largePaste(text)) {
      put()
      return
    }
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return
    put()
  }
  const handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    input.setDragging(false)
    const plainText = event.dataTransfer?.getData("text/plain")
    if (plainText?.startsWith("file:")) {
      const path = plainText.slice("file:".length)
      input.focusEditor()
      input.addPart({ type: "file", path, content: `@${path}`, start: 0, end: 0 })
      return
    }
    const files = event.dataTransfer?.files
    if (files?.length) await addAttachments(Array.from(files))
  }

  // A drop anywhere on the page attaches, so the overlay shows while files are dragged over it.
  onMount(() => {
    makeEventListener(document, "dragover", (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return
      event.preventDefault()
      input.setDragging(true)
    })
    makeEventListener(document, "dragleave", (event) => {
      if (!event.relatedTarget) input.setDragging(false)
    })
    // A drag cancelled with Escape can end without a dragleave.
    makeEventListener(window, "dragend", () => input.setDragging(false))
    makeEventListener(document, "drop", handleDrop)
  })

  return { addAttachments, handlePaste, handleDrop }
}

/** How much of each end of a file the duplicate check reads. */
const EDGE_BYTES = 64 * 1024

/**
 * An id for a file's bytes that reads at most 128 KB of it: the size and both ends. Hashing the
 * whole file held a second copy of a 30 MB video in memory just to spot a double paste.
 */
export async function blobId(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, EDGE_BYTES).arrayBuffer())
  const tail = file.size > EDGE_BYTES ? new Uint8Array(await file.slice(-EDGE_BYTES).arrayBuffer()) : new Uint8Array()
  const size = new TextEncoder().encode(`${file.size}:`)
  const all = new Uint8Array(size.length + head.length + tail.length)
  all.set(size)
  all.set(head, size.length)
  all.set(tail, size.length + head.length)
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", all)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Frees an attachment's object URL. The composer calls it when an attachment is removed or the
 * composer goes away; a sent attachment belongs to its message, and the room store frees it once
 * the upload has landed. Only `blob:` URLs are ours to revoke.
 */
export function releaseBlobUrl(url: string | undefined): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url)
}

function cursorPosition(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return 0
  const before = range.cloneRange()
  before.selectNodeContents(editor)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().replace(/​/g, "").length
}

function largePaste(text: string) {
  if (text.length >= 8000) return true
  return text.split("\n").length - 1 >= 120
}
