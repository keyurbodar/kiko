import { For, type JSX } from "solid-js"
import type { DocumentItem } from "../../lib/types"

const MIDDLE_ELLIPSIS_THRESHOLD = 32
const NAME_HEAD = 20
const NAME_TAIL = 10
const EXTENSION_MAX = 4

const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"])
const SHEET_EXTENSIONS = new Set(["csv", "xls", "xlsx"])
const DOC_EXTENSIONS = new Set(["doc", "docx", "txt", "md", "rtf"])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

function iconColor(item: DocumentItem): string {
  const extension = extensionOf(item.name)
  if (item.mime === "application/pdf" || extension === "pdf") return "bg-file-pdf"
  if (ARCHIVE_EXTENSIONS.has(extension)) return "bg-file-archive"
  if (SHEET_EXTENSIONS.has(extension)) return "bg-file-sheet"
  if (DOC_EXTENSIONS.has(extension)) return "bg-file-doc"
  if (item.mime.startsWith("audio/") || item.mime.startsWith("video/")) return "bg-file-media"
  return "bg-file-default"
}

function middleTruncate(name: string): string {
  if (name.length <= MIDDLE_ELLIPSIS_THRESHOLD) return name
  return `${name.slice(0, NAME_HEAD)}…${name.slice(-NAME_TAIL)}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

export function MessageDocuments(props: {
  items: readonly DocumentItem[]
  side: "user" | "bot"
}): JSX.Element {
  return (
    <div class="flex flex-col" data-side={props.side}>
      <For each={props.items}>
        {(item) => (
          <a
            href={item.src}
            download={item.name}
            target="_blank"
            rel="noopener noreferrer"
            class="flex min-w-60 max-w-80 items-center gap-3 px-3 py-2 text-inherit no-underline hover:bg-[color-mix(in_srgb,currentColor_6%,transparent)]"
            data-component="chat-document"
          >
            <span
              class={`relative flex size-12 shrink-0 items-end justify-center overflow-hidden rounded-[8px] pb-1.5 text-[11px] leading-none font-bold text-white ${iconColor(item)}`}
              aria-hidden="true"
            >
              <span class="absolute end-0 top-0 size-0 border-[9px] border-solid border-t-black/25 border-e-black/25 border-s-transparent border-b-transparent" />
              {extensionOf(item.name).slice(0, EXTENSION_MAX)}
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-[14px] leading-5 font-medium" title={item.name}>
                {middleTruncate(item.name)}
              </span>
              <span class="text-[12px] leading-4 opacity-70">{formatBytes(item.size)}</span>
            </span>
          </a>
        )}
      </For>
    </div>
  )
}
