import { TYPE_GLYPHS } from "./type-glyphs"
import { type FileType, TYPE_TINT } from "./type"

export function TypeIcon(props: { type: FileType; size: number; class?: string }) {
  return (
    <svg
      class={props.class}
      width={props.size}
      height={props.size}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      style={{ color: TYPE_TINT[props.type] }}
      data-component="file-type-icon"
      data-type={props.type}
      innerHTML={TYPE_GLYPHS[props.type]}
    />
  )
}
