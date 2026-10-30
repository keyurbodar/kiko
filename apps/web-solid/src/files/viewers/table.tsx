import type { FileRef } from "@kiko/protocol"
import type { JSX } from "solid-js"
import { fileSrc } from "../../state/room"
import { filePreviewDelimiter } from "../delimited"
import { LargeTextViewer } from "./large-text"

export default function TableView(props: { roomId: string; file: FileRef }): JSX.Element {
  return (
    <LargeTextViewer
      name={props.file.name}
      src={fileSrc(props.roomId, props.file.id)}
      size={props.file.size}
      delimiter={filePreviewDelimiter({ name: props.file.name, type: props.file.type }) ?? ","}
    />
  )
}
