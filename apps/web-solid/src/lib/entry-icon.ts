import { fileIconMarkup } from "@kiko/ui/file-icon"

export function entryIconMarkup(path: string): string {
  return fileIconMarkup(path).replace("<svg ", '<svg class="entry-icon" ')
}
