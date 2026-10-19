import type { PromptInputV2Attachment } from "../prompt-input/types"

export const COMPOSER_CLIPBOARD = "application/x-kiko-composer"
type CopiedFile = { attachment: PromptInputV2Attachment; file: File; dataUrl?: string }
const files = new Map<string, Promise<CopiedFile>>()
const ready = new Map<string, CopiedFile>()
const fragments = new Map<string, { markdown: string; files: CopiedFile[] }>()

export function rememberClipboardFile(attachment: PromptInputV2Attachment, file: File): void {
  ready.set(attachment.id, { attachment, file })
}

/** Keep bytes independently of the source draft, whose object URLs are revoked on removal. */
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
      ready.set(attachment.id, copied)
      return copied
    })
    files.set(attachment.id, pending)
    void pending.catch(() => files.delete(attachment.id))
  }
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")

export function copyComposerFragment(markdown: string, transfer: Pick<DataTransfer, "setData">): void {
  const ids = [...markdown.matchAll(/\[[^\]\n]*\]\(attachment:([\w-]+)\)/g)].map((match) => match[1]!)
  const copied = ids.map((id) => ready.get(id)).filter((file): file is CopiedFile => !!file)
  const key = crypto.randomUUID()
  fragments.clear()
  fragments.set(key, { markdown, files: copied })
  transfer.setData(COMPOSER_CLIPBOARD, key)
  transfer.setData("text/html", `<div data-kiko-clipboard="${key}">${escapeHtml(markdown)}${copied.map(({ attachment, dataUrl }) => attachment.mime.startsWith("image/") && dataUrl ? `<img src="${dataUrl}" alt="${escapeHtml(attachment.filename)}">` : `<a href="${dataUrl ?? ""}" download="${escapeHtml(attachment.filename)}">${escapeHtml(attachment.filename)}</a>`).join("")}</div>`)
}

export function pastedComposerFragment(transfer: Pick<DataTransfer, "getData">) {
  const key = transfer.getData(COMPOSER_CLIPBOARD) || /data-kiko-clipboard="([\w-]+)"/.exec(transfer.getData("text/html"))?.[1]
  return key ? fragments.get(key) : undefined
}
