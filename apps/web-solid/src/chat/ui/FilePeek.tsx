import type { FileRef } from "@kiko/protocol"
import { FileIcon } from "@kiko/ui/file-icon"
import { For, Show, createEffect, createResource, createSignal, on, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { isTextFile, readText } from "../../files/api"
import { formatBytes } from "../info/format"
import "./file-peek.css"

const PEEK_DELAY = 400
const PEEK_BYTES = 2048
const PEEK_LINES = 4

export function FilePeek(props: {
  file: FileRef | undefined
  name: string
  note: string
  anchor: () => HTMLElement | undefined
}) {
  const [open, setOpen] = createSignal(false)
  const [lines] = createResource(
    () => (open() && props.file && isTextFile(props.file) ? props.file : null),
    async (file) => {
      const read = await readText("room", file.id, PEEK_BYTES).catch(() => null)
      return read?.kind === "text"
        ? read.text
            .split("\n")
            .filter((line) => line.trim())
            .slice(0, PEEK_LINES)
        : []
    },
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => clearTimeout(timer)
  onCleanup(clear)
  createEffect(
    on(
      () => props.anchor(),
      (el) => {
        if (!el) return
        const enter = () => {
          clear()
          timer = setTimeout(() => setOpen(true), PEEK_DELAY)
        }
        const leave = () => {
          clear()
          setOpen(false)
        }
        el.addEventListener("pointerenter", enter)
        el.addEventListener("pointerleave", leave)
        el.addEventListener("focus", leave)
        onCleanup(() => {
          el.removeEventListener("pointerenter", enter)
          el.removeEventListener("pointerleave", leave)
          el.removeEventListener("focus", leave)
        })
      },
    ),
  )
  const box = () => props.anchor()?.getBoundingClientRect()
  return (
    <Show when={open() && !lines.loading}>
      <Portal>
        <div
          class="file-peek"
          data-component="chat-file-peek"
          role="tooltip"
          style={{
            left: `${Math.max(8, box()?.left ?? 8)}px`,
            bottom: `${window.innerHeight - (box()?.top ?? window.innerHeight) + 8}px`,
          }}
        >
          <div class="file-peek-head">
            <FileIcon
              style={{ width: "16px", height: "16px" }}
              node={{ path: props.name, type: props.file ? "file" : "directory" }}
            />
            <span class="file-peek-name">{props.name}</span>
            <Show when={props.file}>{(file) => <span class="file-peek-meta">{formatBytes(file().size)}</span>}</Show>
          </div>
          <Show when={lines()?.length}>
            <div class="file-peek-lines">
              <For each={lines()}>{(line) => <span>{line}</span>}</For>
            </div>
          </Show>
          <div class="file-peek-foot">{props.file ? props.note : "Not found in this chat"}</div>
        </div>
      </Portal>
    </Show>
  )
}
