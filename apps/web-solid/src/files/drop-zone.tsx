import { createSignal, For, type JSX } from "solid-js"
import { dragCount, dragGlyphs, dropLine, isFileDrag } from "./drop"
import "./drop.css"
import type { FileType } from "./type"
import { TypeIcon } from "./type-icon"

const FAN: readonly { rotate: number; lift: number }[] = [
  { rotate: -14, lift: 6 },
  { rotate: 0, lift: -4 },
  { rotate: 14, lift: 6 },
]

type Hover = { count: number; glyphs: FileType[] }

export function DropZone(props: { folder: string; onFiles: (files: File[]) => void; children: JSX.Element }) {
  const [hover, setHover] = createSignal<Hover>({ count: 0, glyphs: [] })
  const [over, setOver] = createSignal(false)
  let depth = 0

  const enter = (event: DragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    depth += 1
    const items = event.dataTransfer?.items
    setHover({ count: dragCount(items), glyphs: dragGlyphs(items) })
    setOver(true)
  }
  const leave = (event: DragEvent) => {
    if (!isFileDrag(event)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) setOver(false)
  }
  const move = (event: DragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
  }
  const drop = (event: DragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    depth = 0
    setOver(false)
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length > 0) props.onFiles(files)
  }

  return (
    <div
      class="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-component="files-drop-zone"
      onDragEnter={enter}
      onDragLeave={leave}
      onDragOver={move}
      onDrop={drop}
    >
      {props.children}
      <div
        class="files-drop"
        data-open={over() ? "" : undefined}
        data-component="files-drop-overlay"
        aria-hidden={!over()}
      >
        <div class="files-drop-glyphs">
          <For each={hover().glyphs.length ? hover().glyphs : (["other"] as FileType[])}>
            {(type, index) => (
              <span
                class="files-drop-glyph"
                style={{
                  "--r": `${FAN[hover().glyphs.length === 1 ? 1 : index()]?.rotate ?? 0}deg`,
                  "--y": `${FAN[hover().glyphs.length === 1 ? 1 : index()]?.lift ?? 0}px`,
                }}
              >
                <TypeIcon type={type} size={30} />
              </span>
            )}
          </For>
        </div>
        <p class="files-drop-title">
          Drop to save in <span class="files-drop-folder">{props.folder}</span>
        </p>
        <p class="files-drop-hint">{hover().count > 0 ? dropLine(hover().count) : "Release to save."}</p>
      </div>
    </div>
  )
}
