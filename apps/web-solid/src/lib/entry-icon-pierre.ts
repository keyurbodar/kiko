import { fileIconSprite } from "@kiko/ui/file-icon"
import type { FileTreeIcons } from "@pierre/trees"

const sprite = fileIconSprite()

export const KIKO_FILE_ICONS = {
  set: "complete",
  colored: true,
  spriteSheet: sprite.spriteSheet,
  byFileExtension: sprite.byFileExtension,
  remap: { "file-tree-icon-file": sprite.plain },
} satisfies FileTreeIcons
