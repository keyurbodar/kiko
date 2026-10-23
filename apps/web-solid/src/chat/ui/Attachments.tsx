import { For, Show } from "solid-js"
import { EntryIcon } from "../../lib/EntryIcon"
import { cn } from "../../lib/cn"
import { saveFile, splitFiles, tileSpan } from "../../lib/attachments"
import type { MessageFile } from "../../lib/types"
import { setFileDrag } from "../../lib/file-drag"
import { openFile } from "../side/surfaces"
import { formatBytes } from "../info/format"
import type { DialogImage } from "./image-dialog"

const dragProps = (file: MessageFile) => ({
  draggable: file.path !== undefined,
  onDragStart: (event: DragEvent) => {
    if (file.path && event.dataTransfer) setFileDrag(event.dataTransfer, file.path)
    else event.preventDefault()
  },
})

function preview(roomId: string, file: MessageFile) {
  if (file.path) openFile(roomId, file.path)
  else saveFile(file.src, file.name)
}

export function MessageAttachments(props: {
  files: readonly MessageFile[]
  roomId: string
  onOpenImages?: (images: readonly DialogImage[], index: number, from?: Element | null) => void
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
                  "block aspect-[4/3] cursor-zoom-in overflow-hidden rounded-lg border border-border/80 bg-background/70",
                  tileSpan(split().images.length) === 2 && "col-span-2",
                )}
                aria-label={`Preview ${file.name}`}
                data-component="chat-attachment-image"
                {...dragProps(file)}
                onClick={(event) => props.onOpenImages?.(images(), i(), event.currentTarget)}
              >
                <img
                  src={file.src}
                  alt={file.name}
                  class="block size-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={split().others.length > 0}>
        <div class="flex flex-col gap-1">
          <For each={split().others}>
            {(file) => (
              <button
                type="button"
                class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md py-1 text-start text-sm hover:underline"
                aria-label={`Preview ${file.name}`}
                data-component="chat-attachment-file"
                {...dragProps(file)}
                onClick={() => preview(props.roomId, file)}
              >
                <EntryIcon path={file.name} />
                <span class="min-w-0 flex-1 truncate">{file.name}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
