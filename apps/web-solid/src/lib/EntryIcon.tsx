import "./chip.css"
import { entryIconMarkup } from "./entry-icon"

/** A file's icon inside a chip. The wrapper has no box, so the chip's own icon rules size the svg. */
export function EntryIcon(props: { path: string }) {
  return <span style={{ display: "contents" }} innerHTML={entryIconMarkup(props.path)} />
}
