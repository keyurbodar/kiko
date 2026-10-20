import type { PromptInputV2Attachment } from "../prompt-input/types"

export const COMPOSER_CLIPBOARD = "application/x-kiko-composer"
type CopiedFile = { attachment: PromptInputV2Attachment; file: File; dataUrl?: string }
const files = new Map<string, Promise<CopiedFile>>()
const ready = new Map<string, CopiedFile>()
const fragments = new Map<string, { markdown: string; files: CopiedFile[] }>()

export function rememberClipboardFile(attachment: PromptInputV2Attachment, file: File): void {
  ready.set(attachment.id, { attachment, file })
}

export function prepareClipboardFiles(attachments: readonly PromptInputV2Attachment[]): void {
  const held = new Set(attachments.map((attachment) => attachment.id))
  for (const id of ready.keys()) if (!held.has(id)) ready.delete(id)
  for (const id of files.keys()) if (!held.has(id)) files.delete(id)
  for (const attachment of attachments) {
    if (files.has(attachment.id)) continue
    const pending = fetch(attachment.blob.url).then(async (response) => {
      if (!response.ok) throw new Error("Attachment unavailable")
      const blob = await response.blob()
      const file = new File([blob], attachment.filename, { type: attachment.mime })
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid attachment"))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      const copied = { attachment, file, dataUrl }
      if (files.get(attachment.id) === pending) ready.set(attachment.id, copied)
      return copied
    })
    files.set(attachment.id, pending)
    void pending.catch(() => {
      if (files.get(attachment.id) === pending) files.delete(attachment.id)
    })
  }
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")

function portablePayload(markdown: string, copied: CopiedFile[]): string {
  return JSON.stringify({ version: 1, markdown, files: copied.map(({ attachment, dataUrl }) => ({ id: attachment.id, blobId: attachment.blob.id, filename: attachment.filename, mime: attachment.mime, dataUrl })) })
}

function clipboardHtml(markdown: string, key: string, copied: CopiedFile[], payload?: string): string {
  return `<div data-kiko-clipboard="${key}"${payload ? ` data-kiko-payload="${encodeURIComponent(payload)}"` : ""}>${escapeHtml(markdown)}${copied.map(({ attachment, dataUrl }) => attachment.mime.startsWith("image/") && dataUrl ? `<img src="${dataUrl}" alt="${escapeHtml(attachment.filename)}">` : `<a href="${dataUrl ?? ""}" download="${escapeHtml(attachment.filename)}">${escapeHtml(attachment.filename)}</a>`).join("")}</div>`
}

async function portableFile(copied: CopiedFile): Promise<CopiedFile> {
  if (copied.dataUrl) return copied
  const bytes = new Uint8Array(await copied.file.arrayBuffer())
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { ...copied, dataUrl: `data:${copied.file.type};base64,${btoa(binary)}` }
}

export function copyComposerFragment(markdown: string, transfer: Pick<DataTransfer, "setData">): void {
  const ids = [...markdown.matchAll(/\[[^\]\n]*\]\(attachment:([\w-]+)\)/g)].map((match) => match[1]!)
  const copied = ids.map((id) => ready.get(id)).filter((file): file is CopiedFile => !!file)
  const pending = ids.map((id) => {
    const retained = ready.get(id)
    return retained ? portableFile(retained) : files.get(id)
  })
  const key = crypto.randomUUID()
  fragments.clear()
  fragments.set(key, { markdown, files: copied })
  const payload = copied.length === ids.length && copied.every((entry) => entry.dataUrl) ? portablePayload(markdown, copied) : undefined
  if (payload) fragments.set(payload, { markdown, files: copied })
  transfer.setData(COMPOSER_CLIPBOARD, payload ?? key)
  transfer.setData("text/html", clipboardHtml(markdown, key, copied, payload))
  if (payload || pending.some((file) => !file)) return
  if (typeof navigator === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") return
  const html = Promise.all(pending).then((entries) => {
    const complete = entries.filter((entry): entry is CopiedFile => !!entry)
    return new Blob([clipboardHtml(markdown, key, complete, portablePayload(markdown, complete))], { type: "text/html" })
  })
  void html.catch(() => {})
  try {
    void navigator.clipboard.write([new ClipboardItem({
      "text/html": html,
      "text/plain": new Blob([markdown], { type: "text/plain" }),
    })]).catch(() => {})
  } catch {
  }
}

type PortableFile = Pick<PromptInputV2Attachment, "id" | "filename" | "mime"> & { dataUrl: string; blobId?: string }

function isPortableFile(value: unknown): value is PortableFile {
  return typeof value === "object" && value !== null
    && "id" in value && typeof value.id === "string"
    && "filename" in value && typeof value.filename === "string"
    && "mime" in value && typeof value.mime === "string"
    && "dataUrl" in value && typeof value.dataUrl === "string"
    && (!("blobId" in value) || typeof value.blobId === "string")
}

function readPortableFragment(payload: string) {
  try {
    const value: unknown = JSON.parse(payload)
    if (typeof value !== "object" || value === null
      || !("version" in value) || value.version !== 1
      || !("markdown" in value) || typeof value.markdown !== "string"
      || !("files" in value) || !Array.isArray(value.files)) return undefined
    const copied: CopiedFile[] = []
    for (const entry of value.files) {
      if (!isPortableFile(entry)) return undefined
      const match = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(entry.dataUrl)
      if (!match) return undefined
      const bytes = Uint8Array.from(atob(match[1]!), (character) => character.charCodeAt(0))
      const file = new File([bytes], entry.filename, { type: entry.mime })
      const attachment: PromptInputV2Attachment = { type: "image", id: entry.id, filename: entry.filename, mime: entry.mime, size: file.size, blob: { id: entry.blobId ?? entry.id, url: entry.dataUrl } }
      copied.push({ attachment, file, dataUrl: entry.dataUrl })
    }
    return { markdown: value.markdown, files: copied }
  } catch {
    return undefined
  }
}

export function pastedComposerFragment(transfer: Pick<DataTransfer, "getData">) {
  const custom = transfer.getData(COMPOSER_CLIPBOARD)
  const html = transfer.getData("text/html")
  const key = /data-kiko-clipboard="([\w-]+)"/.exec(html)?.[1]
  const local = fragments.get(custom) ?? (key ? fragments.get(key) : undefined)
  if (local) return local
  const portable = readPortableFragment(custom)
  if (portable) return portable
  const encoded = /data-kiko-payload="([^"]*)"/.exec(html)?.[1]
  if (!encoded) return undefined
  try {
    return readPortableFragment(decodeURIComponent(encoded))
  } catch {
    return undefined
  }
}
