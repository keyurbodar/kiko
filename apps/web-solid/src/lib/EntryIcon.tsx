import { FileIcon } from "@kiko/ui/file-icon"
import "./chip.css"

export function EntryIcon(props: { path: string }) {
  return (
    <span style={{ display: "contents" }}>
      <FileIcon class="entry-icon" node={{ path: props.path, type: props.path.endsWith("/") ? "directory" : "file" }} />
    </span>
  )
}
