import { splitFiles } from "../../lib/attachments"
import type { MessageFile } from "../../lib/types"
export type DialogImage = { src: string; name: string; path?: string; video?: true }

export function messageGallery(files: readonly MessageFile[]): DialogImage[] {
  const { images, videos } = splitFiles(files)
  const item = (file: MessageFile, video: boolean): DialogImage => ({
    src: file.src,
    name: file.name,
    ...(file.path ? { path: file.path } : {}),
    ...(video ? { video: true as const } : {}),
  })
  return [...images.map((file) => item(file, false)), ...videos.map((file) => item(file, true))]
}
