import { Show } from "solid-js"
import { fileType, type FileType } from "../../files/type"
import type { PromptInputV2Attachment } from "./types"

export const PASTED_TEXT = "Pasted text.txt"

export type TileLook = "image" | "video" | "type"

const LOOKS: Partial<Record<FileType, TileLook>> = {
  image: "image",
  video: "video",
}

type Named = Pick<PromptInputV2Attachment, "filename" | "mime">

function tileType(part: Named): FileType {
  return fileType({ name: part.filename, type: part.mime })
}

export function tileLook(part: Named): TileLook {
  return LOOKS[tileType(part)] ?? "type"
}

export function tileBadge(part: Named): string {
  if (part.filename === PASTED_TEXT) return "Pasted"
  const ext = /\.([^./]+)$/.exec(part.filename)?.[1]
  return ext && ext.length <= 5 ? ext.toUpperCase() : "File"
}

export function TileThumb(props: { part: PromptInputV2Attachment; onBroken?: () => void }) {
  return (
    <Show
      when={tileLook(props.part) === "video"}
      fallback={
        <img
          class="tray-thumb"
          src={props.part.blob.url}
          alt={props.part.filename}
          draggable={false}
          onError={props.onBroken}
        />
      }
    >
      <video
        class="tray-thumb"
        src={`${props.part.blob.url}#t=0.1`}
        muted
        playsinline
        preload="metadata"
        aria-hidden="true"
        onError={props.onBroken}
      />
    </Show>
  )
}
