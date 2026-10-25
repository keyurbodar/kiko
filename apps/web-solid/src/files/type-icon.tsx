import { FileIcon } from "@kiko/ui/file-icon"
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
  other: "file",
}

export function TypeIcon(props: { type: FileType; size: number; class?: string }) {
  return (
    <FileIcon
      class={props.class}
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      node={{ path: SAMPLE[props.type], type: "file" }}
      data-type={props.type}
    />
  )
}
