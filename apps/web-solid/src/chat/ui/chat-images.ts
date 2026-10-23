import { isImage } from "../../lib/attachments"
import type { DialogImage } from "./image-dialog"

export function chatImages(
  messages: readonly { files?: readonly { src: string; name: string; type: string }[] }[],
  clicked: DialogImage,
): { images: DialogImage[]; index: number } {
  const all = messages.flatMap((m) =>
    (m.files ?? []).filter((f) => isImage(f)).map((f): DialogImage => ({ src: f.src, name: f.name })),
  )
  const index = all.findIndex((image) => image.src === clicked.src)
  return index < 0 ? { images: [clicked], index: 0 } : { images: all, index }
}
