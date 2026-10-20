import "./chip.css"
import { entryIconMarkup } from "./entry-icon"

export function EntryIcon(props: { path: string }) {
  return <span style={{ display: "contents" }} innerHTML={entryIconMarkup(props.path)} />
}
