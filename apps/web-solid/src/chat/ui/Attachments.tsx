import { createSignal, For, Show } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, DownloadIcon, PlayIcon } from "@kiko/ui/icons"
import { EntryIcon } from "../../lib/EntryIcon"
import { isVideo, saveFile, splitFiles } from "../../lib/attachments"
import type { MessageFile } from "../../lib/types"
import { setFileDrag } from "../../lib/file-drag"
import { openFile } from "../side/surfaces"
import { formatBytes } from "../info/format"
import { messageGallery, type DialogImage } from "./chat-images"
import "./attachments.css"

const FILES_SHOWN = 3
const TILES_SHOWN = 4

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
  onOpenImages?: (images: readonly DialogImage[], index: number) => void
}) {
  const split = () => splitFiles(props.files)
  const gallery = () => messageGallery(props.files)
  const media = () => [...split().images, ...split().videos]
  const tiles = () => media().slice(0, TILES_SHOWN)
  const hidden = () => media().length - TILES_SHOWN
  const [allFiles, setAllFiles] = createSignal(false)
  const files = () => (allFiles() ? split().others : split().others.slice(0, FILES_SHOWN))
  const moreFiles = () => split().others.length - FILES_SHOWN
  return (
    <div class="flex flex-col gap-1.5" data-component="chat-attachments">
      <Show when={media().length > 0}>
        <div class="att-grid" data-count={Math.min(media().length, 3)}>
          <For each={tiles()}>
            {(file, i) => (
              <button
                type="button"
                aria-label={`Preview ${file.name}`}
                data-component="chat-attachment-image"
                {...dragProps(file)}
                onClick={() => props.onOpenImages?.(gallery(), i())}
              >
                <Show
                  when={isVideo(file)}
                  fallback={<img src={file.src} alt={file.name} loading="lazy" draggable={false} />}
                >
                  <video src={`${file.src}#t=0.1`} preload="metadata" muted playsinline tabindex={-1} />
                  <span class="att-play" aria-hidden="true">
                    <RemixIcon icon={PlayIcon} size={16} />
                  </span>
                </Show>
                <Show when={i() === TILES_SHOWN - 1 && hidden() > 0}>
                  <span class="att-more" aria-hidden="true">
                    +{hidden()}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={split().others.length > 0}>
        <div class="att-files">
          <For each={files()}>
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
                  <span class="att-name">{file.name}</span>
                  <span class="att-meta">{formatBytes(file.size)}</span>
                </button>
                <button
                  type="button"
                  class="att-download"
                  aria-label={`Download ${file.name}`}
                  data-action="download-file"
                  onClick={() => saveFile(file.src, file.name)}
                >
                  <RemixIcon icon={DownloadIcon} size={16} />
                </button>
              </div>
            )}
          </For>
          <Show when={moreFiles() > 0}>
            <div class="att-foot">
              <Show when={!allFiles()} fallback={<span />}>
                <button type="button" class="att-foot-action" onClick={() => setAllFiles(true)}>
                  <RemixIcon icon={ChevronDownIcon} size={16} />
                  Show {moreFiles()} more
                </button>
              </Show>
              <button
                type="button"
                class="att-foot-action"
                data-action="download-all"
                onClick={() => {
                  for (const file of split().others) saveFile(file.src, file.name)
                }}
              >
                <RemixIcon icon={DownloadIcon} size={16} />
                Download all
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
