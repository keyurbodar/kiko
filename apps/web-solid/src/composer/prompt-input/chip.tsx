import { render } from "solid-js/web"
import { isImage } from "../../lib/attachments"
import { EntryIcon } from "../../lib/EntryIcon"
import { formatBytes } from "../../chat/info/format"
import { progressLabel, retryUpload, uploadState } from "../../sync/uploads"
import { fileName } from "@kiko/protocol"
import type { ChipView, FileRefView } from "../rich/nodes"
import { middleTruncate } from "../rich/nodes"
import type { PromptInputV2Attachment } from "./types"

type Source = { attachments: () => PromptInputV2Attachment[]; openAttachment: (attachment: PromptInputV2Attachment) => void }

/**
 * An attachment named in the composer's text, as t3code's context chip: the picture or the
 * file's icon, its name, and its size, or how far its upload has got. A picture opens the
 * preview, a file opens in a new tab, and a failed upload retries. A chip whose file is gone
 * (a draft restored without it) is drawn dashed.
 */
function Chip(props: { id: string; name: string; source: Source }) {
  const part = () => props.source.attachments().find((p) => p.id === props.id)
  const image = () => {
    const p = part()
    return !!p && isImage({ name: p.filename, type: p.mime })
  }
  const upload = () => uploadState(props.id)
  const meta = () => {
    const u = upload()
    const p = part()
    if (!p) return "Gone"
    if (u?.status === "uploading") return progressLabel(u.progress)
    if (u?.status === "failed") return "Retry"
    return formatBytes(p.size)
  }
  const open = () => {
    const p = part()
    if (!p) return
    if (upload()?.status === "failed") return retryUpload(props.id)
    if (image()) return props.source.openAttachment(p)
    window.open(p.blob.url, "_blank", "noopener")
  }
  return (
    <button
      type="button"
      class="file-chip"
      data-component="composer-chip"
      data-kind={image() ? "image" : "file"}
      data-state={upload()?.status}
      data-missing={part() ? undefined : ""}
      title={upload()?.status === "failed" ? (upload() as { reason: string }).reason : props.name}
      aria-label={`${props.name}, ${meta()}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={open}
    >
      {image() ? <img class="file-chip-thumb" src={part()!.blob.url} alt="" draggable={false} /> : <EntryIcon path={props.name} />}
      <span class="file-chip-label">{middleTruncate(props.name, 28)}</span>
      <span class="file-chip-meta">{meta()}</span>
    </button>
  )
}

export const chipView =
  (source: Source): ChipView =>
  (dom, attachment) =>
    render(() => <Chip id={attachment.id} name={attachment.name} source={source} />, dom)

function FileRef(props: { path: string }) {
  const name = () => fileName(props.path)
  return (
    <span class="file-chip" data-component="composer-file-ref" data-kind="file" title={`/${props.path}`} aria-label={name()}>
      <EntryIcon path={name()} />
      <span class="file-chip-label">{middleTruncate(name(), 28)}</span>
    </span>
  )
}

export const fileRefView: FileRefView = (dom, ref) => render(() => <FileRef path={ref.path} />, dom)
