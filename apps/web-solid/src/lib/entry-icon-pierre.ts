import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees"

/*
 * Pierre's icon set. It is loaded on demand from entry-icon.ts, so the sprite and the resolver
 * stay out of the first paint. Nothing else imports this file.
 */

const resolver = createFileTreeIconResolver({
  set: "complete",
  colored: true,
  byFileName: {
    "package.json": "file-tree-builtin-npm",
    "tsconfig.json": "file-tree-builtin-typescript",
  },
})

export const entrySpriteSheet = (): string => getBuiltInSpriteSheet("complete")

/** The sprite id and the color token of a file name or path. */
export function resolveEntryIcon(path: string): { name: string; token: string } {
  const icon = resolver.resolveIcon("file-tree-icon-file", path)
  return { name: icon.name, token: icon.token ?? "default" }
}
