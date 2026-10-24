import { For, Show } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { DownloadIcon } from "@kiko/ui/icons"
import { EntryIcon } from "../../lib/EntryIcon"
import { saveFile, splitFiles } from "../../lib/attachments"
import type { MessageFile } from "../../lib/types"
import { setFileDrag } from "../../lib/file-drag"
import { openFile } from "../side/surfaces"
import { formatBytes } from "../info/format"
import type { DialogImage } from "./image-dialog"
import "./attachments.css"

const MOSAIC_MAX = 5

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

function mosaicCount(count: number): string {
  return count > 4 ? "many" : String(count)
}

export function MessageAttachments(props: {
  files: readonly MessageFile[]
  roomId: string
  onOpenImages?: (images: readonly DialogImage[], index: number, from?: Element | null) => void
}) {
  const split = () => splitFiles(props.files)
  const images = () => split().images.map((f): DialogImage => ({ src: f.src, name: f.name }))
  const shown = () => split().images.slice(0, MOSAIC_MAX)
  const hidden = () => split().images.length - MOSAIC_MAX
  return (
    <div class="flex flex-col gap-2" data-component="chat-attachments">
      <Show when={split().images.length > 0}>
        <div class="att-mosaic" data-count={mosaicCount(shown().length)}>
          <For each={shown()}>
            {(file, i) => (
              <button
                type="button"
                aria-label={`Preview ${file.name}`}
                data-component="chat-attachment-image"
                {...dragProps(file)}
                onClick={(event) => props.onOpenImages?.(images(), i(), event.currentTarget)}
              >
                <img src={file.src} alt={file.name} loading="lazy" draggable={false} />
                <Show when={i() === MOSAIC_MAX - 1 && hidden() > 0}>
                  <span class="att-more">+{hidden()}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={split().others.length > 0}>
        <div class="att-files">
          <For each={split().others}>
            {(file) => (
              <div class="att-file">
                <button
                  type="button"
                  class="att-open"
                  aria-label={`Preview ${file.name}`}
                  data-component="chat-attachment-file"
                  title={file.name}
                  {...dragProps(file)}
                  onClick={() => preview(props.roomId, file)}
                >
                  <span class="att-tile">
                    <EntryIcon path={file.name} />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="att-name">{file.name}</span>
                    <span class="att-meta">{formatBytes(file.size)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="att-download"
                  aria-label={`Download ${file.name}`}
                  data-action="download-file"
                  onClick={() => saveFile(file.src, file.name)}
                >
                  <RemixIcon icon={DownloadIcon} size={17} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
