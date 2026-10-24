import { createSignal, onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { MAX_IMAGE_BYTES, attachmentError, attachmentKind, attachmentLimit, attachmentMessages } from "@kiko/protocol"
import { formatBytes } from "../../chat/info/format"
import { admit, attachmentType } from "../../lib/attachments"
import { droppedFilePath, hasFileDrag } from "../../lib/file-drag"
import { prepareImageForAttachment } from "../../lib/image-compression"
import { rememberClipboardFile } from "../rich/clipboard"
import { entriesOf, hasFolder, walkEntries } from "./dropped"
import type { PromptInputV2Attachment, PromptInputV2Prompt } from "./types"

type PromptTarget = {
  current: () => PromptInputV2Prompt
  cursor: () => number | undefined
  set: (prompt: PromptInputV2Prompt, cursor?: number) => void
}

export type Refusal = { name?: string; reason: string }

export type PromptInputV2AttachmentConfig = {
  blocked?: () => string | null
  refuse: (refusals: Refusal[]) => void
  onAdded?: (attachment: PromptInputV2Attachment, file: File) => void
  onDiscarded?: (attachment: PromptInputV2Attachment) => void
  key?: () => string
}

const [preparing, setPreparing] = createSignal(0)

export const preparingAttachments = () => preparing() > 0

export function createPromptInputV2Attachments(
  input: PromptInputV2AttachmentConfig & {
    capture: () => PromptTarget
    editor: () => HTMLElement | undefined
    focusEditor: () => void
    addPart: (part: PromptInputV2Prompt[number]) => boolean
    fileRef: (paths: readonly string[], at?: { x: number; y: number }) => void
    setDragging: (dragging: boolean) => void
  },
) {
  const capture = (): PromptTarget => {
    const prompt = input.capture()
    const editor = input.editor()
    return { ...prompt, cursor: () => prompt.cursor() ?? (editor ? cursorPosition(editor) : undefined) }
  }
  const [dragKind, setDragKind] = createSignal<"files" | "reference">("files")
  const addAttachments = async (files: File[], target = capture(), notes: string[] = []) => {
    const blocked = input.blocked?.()
    if (blocked) return void input.refuse([{ reason: blocked }])
    const openedFor = input.key?.()
    const held = target.current().filter((part) => part.type === "image")
    const { images, files: others } = admit(held.length, files)
    const admitted = new Set<File>([...images, ...others])
    const refusals: Refusal[] = [
      ...notes.map((reason) => ({ reason })),
      ...files.filter((file) => !admitted.has(file)).map((file) => ({ name: file.name, reason: shortRefusal(file) })),
    ]
    const added: PromptInputV2Attachment[] = []
    const abandoned = () => openedFor !== undefined && input.key?.() !== openedFor
    const release = () => {
      for (const part of added.splice(0)) {
        releaseBlobUrl(part.blob.url)
        input.onDiscarded?.(part)
      }
    }
    const take = async (file: File) => {
      if (abandoned()) return
      const id = await blobId(file)
      if (abandoned()) return
      if ([...held, ...added].some((part) => part.blob.id === id)) return
      const attachment: PromptInputV2Attachment = {
        type: "image",
        id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2),
        filename: file.name || "file",
        mime: attachmentType(file),
        size: file.size,
        blob: { id, url: URL.createObjectURL(file) },
      }
      rememberClipboardFile(attachment, file)
      added.push(attachment)
      input.onAdded?.(attachment, file)
    }
    setPreparing((count) => count + 1)
    try {
      for (const file of others) await take(file)
      await prepareImages(images, take, refusals, abandoned)
    } finally {
      setPreparing((count) => count - 1)
    }
    if (abandoned()) return release()
    if (refusals.length) input.refuse(refusals)
    if (!added.length) return
    target.set([...target.current(), ...added], target.cursor())
  }
  const insertPastedText = (text: string) => {
    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return
      input.focusEditor()
      input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }
    if (text.includes("\n") || largePaste(text)) return put()
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return
    put()
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
      return file ? [pastedName(file)] : []
    })
    const plainText = clipboardData.getData("text/plain") ?? ""
    const text = plainText.includes("\r") ? plainText.replace(/\r\n?/g, "\n") : plainText
    if (files.length > 0) {
      await addAttachments(files, target)
      if (text) insertPastedText(text)
      return
    }
    if (!text) return
    insertPastedText(text)
  }
  const handleDrop = async (event: DragEvent) => {
    input.setDragging(false)
    const transfer = event.dataTransfer
    const at = { x: event.clientX, y: event.clientY }
    const path = droppedFilePath(transfer)
    if (path) {
      event.preventDefault()
      const blocked = input.blocked?.()
      if (blocked) return input.refuse([{ reason: blocked }])
      input.fileRef([path], at)
      return
    }
    if (!transfer?.files.length) return
    event.preventDefault()
    const entries = entriesOf(transfer.items)
    const files = Array.from(transfer.files)
    const target = capture()
    if (!hasFolder(entries)) return void addAttachments(files, target)
    const walked = await walkEntries(entries)
    const notes = walked.truncated ? [attachmentMessages.folderCut] : []
    if (!walked.files.length) return input.refuse([{ reason: attachmentMessages.folderEmpty }])
    await addAttachments(walked.files, target, notes)
  }

  onMount(() => {
    makeEventListener(document, "dragover", (event) => {
      const reference = hasFileDrag(event.dataTransfer)
      if (!reference && !event.dataTransfer?.types.includes("Files")) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
      setDragKind(reference ? "reference" : "files")
      input.setDragging(true)
    })
    makeEventListener(document, "dragleave", (event) => {
      if (!event.relatedTarget) input.setDragging(false)
    })
    makeEventListener(window, "dragend", () => input.setDragging(false))
    makeEventListener(document, "drop", handleDrop)
  })

  return { addAttachments, handlePaste, handleDrop, dragKind }
}

function shortRefusal(file: File): string {
  if (attachmentKind(file) === "unsupported-image") return "Not a supported image type"
  if (file.size <= 0) return "Empty or unreadable"
  if (attachmentError(file)) return `Over ${formatBytes(attachmentLimit(attachmentType(file)))}. Share a link?`
  return attachmentMessages.tooMany
}

async function prepareImages(
  images: File[],
  take: (file: File) => Promise<void>,
  refusals: Refusal[],
  abandoned: () => boolean,
) {
  for (const file of images) {
    if (abandoned()) return
    const type = attachmentType(file)
    const typed = file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified })
    const prepared = await prepareImageForAttachment(typed, MAX_IMAGE_BYTES)
    if (prepared.ok) await take(prepared.file)
    else
      refusals.push({
        name: file.name,
        reason: prepared.reason === "unreadable" ? "Could not be read as an image" : "Too large, even compressed",
      })
  }
}

const EDGE_BYTES = 64 * 1024

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

function pastedName(file: File): File {
  const generic = /^image\.(\w+)$/.exec(file.name)
  return generic
    ? new File([file], `Pasted image.${generic[1]}`, { type: file.type, lastModified: file.lastModified })
    : file
}

function largePaste(text: string) {
  if (text.length >= 8000) return true
  return text.split("\n").length - 1 >= 120
}
