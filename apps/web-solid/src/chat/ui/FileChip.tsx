import { fileName } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CopyIcon, FileIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"
import { isImage } from "../../lib/attachments"
import { setFileDrag } from "../../lib/file-drag"
import { fileSrc, room } from "../../state/room"
import { user } from "../../state/user"
import { formatBytes } from "../info/format"
import { openThreadImages } from "./image-dialog"
import { fixedSurface, openFile, openSurface } from "../side/surfaces"
import { resolveFile, type FileTarget } from "../rich/file-links"
import { fileType } from "../../files/type"
import { TypeIcon } from "../../files/type-icon"
import { TYPE_GLYPHS } from "../../files/type-glyphs"
import "./chips.css"

function ChipGlyph(props: { path: string; folder: boolean; picture: string | null }) {
  return (
    <Show
      when={props.picture}
      fallback={
        <Show
          when={!props.folder}
          fallback={
            <svg
              class="lchip-folder"
              width="16"
              height="16"
              viewBox="0 0 256 256"
              fill="currentColor"
              aria-hidden="true"
              innerHTML={TYPE_GLYPHS.folder}
            />
          }
        >
          <TypeIcon type={fileType({ name: props.path, type: "" })} size={16} />
        </Show>
      }
    >
      {(src) => <img class="lchip-thumb" src={src()} alt="" loading="lazy" draggable={false} />}
    </Show>
  )
}

function find(path: string) {
  const own = resolveFile(
    path,
    room.files().map((f) => f.name),
    room.folders(),
  )
  if (own.kind !== "none") return own
  return resolveFile(
    path,
    user.homeFiles().map((f) => `home/${f.name}`),
    user.homeFolders().map((f) => `home/${f}`),
  )
}

export function FileChip(props: { file: FileTarget; label: string; bare?: boolean }): JSX.Element {
  const full = () => `${props.file.path}${props.file.line ? `:${props.file.line}` : ""}`
  const spoken = () => `${fileName(props.file.path)}${props.file.line ? `, line ${props.file.line}` : ""}`
  const isChip = () => !props.bare || find(props.file.path).kind !== "none"
  const chat = () => room.activeId()
  const ref = () => {
    const found = find(props.file.path)
    return found.kind === "file" ? room.files().find((f) => f.name === found.path) : undefined
  }
  const picture = () => {
    const f = ref()
    const id = chat()
    return f && id && isImage({ name: f.name, type: f.type }) ? fileSrc(id, f.id) : null
  }
  const size = () => {
    const f = ref()
    return f?.name.startsWith("attachments/") ? formatBytes(f.size) : null
  }
  const folder = () => find(props.file.path).kind === "folder"
  const open = (from?: Element | null) => {
    const id = chat()
    if (!id) return
    const src = picture()
    const at = ref()?.name
    if (src)
      return openThreadImages(
        [{ src, name: props.label, ...(at ? { path: at } : {}) }],
        0,
        from?.querySelector("img") ?? from,
      )
    const found = find(props.file.path)
    if (found.kind === "file") return openFile(id, found.path, props.file.line)
    if (found.kind === "folder" || found.kind === "many") return openSurface(id, fixedSurface("files"))
    showToastV2({ title: `No file named ${fileName(props.file.path)} in this chat`, variant: "error" })
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full())
      showToastV2({ title: "Path copied", variant: "success" })
    } catch {
      showToastV2({
        title: "Could not copy",
        description: "The clipboard is not available in this context",
        variant: "error",
      })
    }
  }
  return (
    <Show when={isChip()} fallback={<code class="rich-inline-code">{full()}</code>}>
      <TooltipV2 class="lchip-anchor" placement="top" value={<span class="font-mono">{full()}</span>}>
        <MenuV2.Context gutter={4}>
          <MenuV2.Context.Trigger
            as="button"
            type="button"
            class="lchip"
            data-component="chat-file-chip"
            data-kind={picture() ? "image" : folder() ? "folder" : "file"}
            data-path={props.file.path}
            data-missing={find(props.file.path).kind === "none" ? "" : undefined}
            aria-label={`${folder() ? "Show" : "Open"} ${spoken()}`}
            draggable={ref() !== undefined || folder()}
            onDragStart={(event: DragEvent) => {
              const file = ref()
              if (!event.dataTransfer) return event.preventDefault()
              if (folder()) return setFileDrag(event.dataTransfer, `${props.file.path.replace(/\/+$/, "")}/`)
              if (!file) return event.preventDefault()
              setFileDrag(event.dataTransfer, file.name)
            }}
            onClick={(event: MouseEvent) => open(event.currentTarget as Element)}
          >
            <ChipGlyph path={props.file.path} folder={folder()} picture={picture()} />
            <span class="lchip-label">{props.label}</span>
            <Show when={size()}>{(text) => <span class="lchip-meta">{text()}</span>}</Show>
          </MenuV2.Context.Trigger>
          <MenuV2.Context.Portal>
            <MenuV2.Context.Content class="min-w-[160px]">
              <MenuV2.Item onSelect={() => open()}>
                <RemixIcon icon={FileIcon} class="size-3.5 shrink-0" />
                {folder() ? "Show in files" : "Open"}
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => void copy()}>
                <RemixIcon icon={CopyIcon} class="size-3.5 shrink-0" />
                Copy path
              </MenuV2.Item>
            </MenuV2.Context.Content>
          </MenuV2.Context.Portal>
        </MenuV2.Context>
      </TooltipV2>
    </Show>
  )
}
