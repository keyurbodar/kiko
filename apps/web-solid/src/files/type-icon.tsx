import { FileIcon, fileTone } from "@kiko/ui/file-icon"
import type { FileType } from "./type"

const SAMPLE: Record<FileType, string> = {
  pdf: "file.pdf",
  markdown: "file.md",
  csv: "file.csv",
  sheet: "file.xlsx",
  html: "file.html",
  image: "file.jpg",
  code: "file.ts",
  text: "file.txt",
  video: "file.mp4",
  audio: "file.mp3",
  archive: "file.zip",
  doc: "file.docx",
  slides: "file.pptx",
  mermaid: "file.mmd",
  notebook: "file.ipynb",
  font: "file.woff",
  other: "file",
}

const GREY = ["#6f7480", "#9ea3ae"] as const

function toneOfType(type: FileType): string {
  const [light, dark] = fileTone(SAMPLE[type]) ?? GREY
  return `light-dark(${light}, ${dark})`
}

export function TypeIcon(props: { type: FileType; size: number; class?: string }) {
  const tinted = () => props.size >= 24
  return (
    <span
      class={props.class}
      style={{
        display: "inline-flex",
        width: `${props.size}px`,
        height: `${props.size}px`,
        "flex-shrink": 0,
        "align-items": "center",
        "justify-content": "center",
        color: toneOfType(props.type),
        "border-radius": `${Math.max(4, Math.round(props.size * 0.22))}px`,
        background: tinted() ? `color-mix(in oklab, ${toneOfType(props.type)} 12%, transparent)` : undefined,
      }}
      data-component="file-type-icon"
      data-type={props.type}
      data-tinted={tinted() ? "" : undefined}
    >
      <FileIcon style={{ width: "100%", height: "100%" }} node={{ path: SAMPLE[props.type], type: "file" }} />
    </span>
  )
}
