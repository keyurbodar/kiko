import { CopyIcon, FileIcon as OpenIcon } from "lucide-solid"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"
import { EntryIcon } from "../../lib/EntryIcon"
import { isImage } from "../../lib/attachments"
import { setFileDrag } from "../../lib/file-drag"
import { urls, useApp } from "../../lib/store"
import { formatBytes } from "../info/format"
import { openThreadImages } from "./image-dialog"
import { fixedSurface, openFile, openSurface } from "../side/surfaces"
import { basename, resolveFile, type FileTarget } from "../rich/file-links"

/** Where a named file is: the chat's own files first, then the user's home drive. */
function find(path: string) {
  const own = resolveFile(path, useApp.activeFiles().map((f) => f.name))
  return own.kind !== "none" ? own : resolveFile(path, useApp.homeFiles().map((f) => `home/${f.name}`))
}

/**
 * A file an agent's message names, as t3code's file mention: the file's icon and name in a
 * small tinted pill. A click opens it in the files tab. A name the chat has no file for draws
 * a dashed edge and says so on click. A name several files share opens the tree to pick from.
 */
export function FileChip(props: { file: FileTarget; label: string; bare?: boolean }): JSX.Element {
  const full = () => `${props.file.path}${props.file.line ? `:${props.file.line}` : ""}`
  // A bare name the chat does not have is code, not a missing file, so it does not show a chip.
  // It is a reactive check: the chat's file list can arrive after the first paint of a message.
  const isChip = () => !props.bare || find(props.file.path).kind !== "none"
  const chat = () => useApp.activeThreadId()
  /** The chat's own file at this path, when there is exactly one. */
  const ref = () => {
    const found = find(props.file.path)
    return found.kind === "file" ? useApp.activeFiles().find((f) => f.name === found.path) : undefined
  }
  const picture = () => {
    const f = ref()
    const id = chat()
    return f && id && isImage({ name: f.name, type: f.type }) ? urls.file(id, f.id) : null
  }
  // An attachment says its size, as t3code's chip does.
  const size = () => {
    const f = ref()
    return f?.name.startsWith("attachments/") ? formatBytes(f.size) : null
  }
  const open = (from?: Element | null) => {
    const id = chat()
    if (!id) return
    const src = picture()
    if (src) return openThreadImages([{ src, name: props.label }], 0, from?.querySelector("img") ?? from)
    const found = find(props.file.path)
    if (found.kind === "file") return openFile(id, found.path, props.file.line)
    if (found.kind === "many") return openSurface(id, fixedSurface("files"))
    showToastV2({ title: `No file named ${basename(props.file.path)} in this chat`, variant: "error" })
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full())
      showToastV2({ title: "Path copied", variant: "success" })
    } catch {
      showToastV2({ title: "Could not copy", description: "The clipboard is not available in this context", variant: "error" })
    }
  }
  return (
    <Show when={isChip()} fallback={<code class="rich-inline-code">{full()}</code>}>
    <TooltipV2 class={size() ? "file-chip-anchor file-chip-attached" : "file-chip-anchor"} placement="top" value={<span class="font-mono">{full()}</span>}>
      <MenuV2.Context gutter={4}>
        <MenuV2.Context.Trigger
          as="button"
          type="button"
          class="file-chip"
          data-component="chat-file-chip"
          data-kind={picture() ? "image" : "file"}
          data-path={props.file.path}
          data-missing={find(props.file.path).kind === "none" ? "" : undefined}
          aria-label={`Open ${full()}`}
          draggable={ref() !== undefined}
          onDragStart={(event: DragEvent) => {
            const file = ref()
            if (!file || !event.dataTransfer) return event.preventDefault()
            setFileDrag(event.dataTransfer, file.name)
          }}
          onClick={(event: MouseEvent) => open(event.currentTarget as Element)}
        >
          <Show when={picture()} fallback={<EntryIcon path={props.file.path} />}>
            {(src) => <img class="file-chip-thumb" src={src()} alt="" loading="lazy" draggable={false} />}
          </Show>
          <span class="file-chip-label">{props.label}</span>
          <Show when={size()}>{(text) => <span class="file-chip-meta">{text()}</span>}</Show>
        </MenuV2.Context.Trigger>
        <MenuV2.Context.Portal>
          <MenuV2.Context.Content class="min-w-[160px]">
            <MenuV2.Item onSelect={() => open()}>
              <OpenIcon class="size-3.5 shrink-0" aria-hidden="true" />
              Open
            </MenuV2.Item>
            <MenuV2.Item onSelect={() => void copy()}>
              <CopyIcon class="size-3.5 shrink-0" aria-hidden="true" />
              Copy path
            </MenuV2.Item>
          </MenuV2.Context.Content>
        </MenuV2.Context.Portal>
      </MenuV2.Context>
    </TooltipV2>
    </Show>
  )
}
