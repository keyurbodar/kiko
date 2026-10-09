import { For, Show } from "solid-js"
import { FileIcon } from "@kiko/ui/file-icon"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { DownloadIcon, EyeIcon } from "@kiko/ui/icons"
import { cn } from "../../lib/cn"
import { splitFiles, tileSpan } from "../../lib/attachments"
import type { MessageFile } from "../../lib/types"
import { openFile } from "../info/state"
import type { DialogImage } from "./image-dialog"

/*
 * A message's attachments, after t3code's user message: its pictures as a small grid of 4:3
 * tiles that open the image dialog, then its other files as rows with a preview and a download.
 * A file's type decides which it is, so a message stored with the old media draws the same way.
 */

/** A stored file opens in the files tab, which says so when it cannot draw it. One still uploading opens in a new tab. */
function preview(roomId: string, file: MessageFile) {
  if (file.path) openFile(roomId, file.path)
  else window.open(file.src, "_blank", "noopener")
}

export function MessageAttachments(props: {
  files: readonly MessageFile[]
  roomId: string
  onOpenImages?: (images: readonly DialogImage[], index: number) => void
}) {
  const split = () => splitFiles(props.files)
  const images = () => split().images.map((f): DialogImage => ({ src: f.src, name: f.name }))
  return (
    <div class="flex flex-col gap-2" data-component="chat-attachments">
      <Show when={split().images.length > 0}>
        <div class="grid max-w-[210px] grid-cols-2 gap-2">
          <For each={split().images}>
            {(file, i) => (
              <button
                type="button"
                class={cn(
                  "block aspect-[4/3] cursor-zoom-in overflow-hidden rounded-lg border border-hairline/80 bg-bg/70",
                  tileSpan(split().images.length) === 2 && "col-span-2",
                )}
                aria-label={`Preview ${file.name}`}
                data-component="chat-attachment-image"
                onClick={() => props.onOpenImages?.(images(), i())}
              >
                <img src={file.src} alt={file.name} class="block size-full object-cover" loading="lazy" draggable={false} />
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={split().others.length > 0}>
        <div class="flex flex-col gap-1">
          <For each={split().others}>
            {(file) => (
              <div class="flex min-w-0 items-center gap-1" data-component="chat-attachment-file">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 text-start text-sm hover:underline focus-visible:outline-2"
                  aria-label={`Preview ${file.name}`}
                  onClick={() => preview(props.roomId, file)}
                >
                  <FileIcon node={{ path: file.name, type: "file" }} class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{file.name}</span>
                  <HugeIcon icon={EyeIcon} class="size-4 shrink-0" />
                </button>
                <a
                  href={file.src}
                  download={file.name}
                  class="grid size-6 shrink-0 place-items-center rounded-md opacity-70 hover:bg-hover hover:opacity-100"
                  aria-label={`Download ${file.name}`}
                  title={`Download ${file.name}`}
                  data-action="download"
                >
                  <HugeIcon icon={DownloadIcon} class="size-3.5" />
                </a>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
