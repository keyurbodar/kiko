import type { FileRef } from "@kiko/protocol"
import { createMemo, onCleanup } from "solid-js"
import { WithText } from "./with-text"

export default function HtmlView(props: { roomId: string; file: FileRef }) {
  return (
    <WithText roomId={props.roomId} file={props.file}>
      {(text) => {
        let previous: string | undefined
        const url = createMemo(() => {
          const next = URL.createObjectURL(new Blob([text], { type: "text/html" }))
          if (previous) URL.revokeObjectURL(previous)
          previous = next
          return next
        })
        onCleanup(() => {
          if (previous) URL.revokeObjectURL(previous)
          previous = undefined
        })
        return (
          <iframe
            class="min-h-0 flex-1 border-0 bg-white"
            src={url()}
            title={props.file.name}
            sandbox="allow-scripts allow-forms allow-popups"
            data-component="file-html"
          />
        )
      }}
    </WithText>
  )
}
