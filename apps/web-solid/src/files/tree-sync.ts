import type { FileTree } from "@pierre/trees"
import { buildFileTreePathUpdates } from "./explorer/path-updates"

export function syncTree(
  tree: Pick<FileTree, "batch" | "add" | "remove">,
  held: ReadonlySet<string>,
  target: ReadonlySet<string>,
  pending: ReadonlyMap<string, unknown>,
): Set<string> {
  const previous = [...held].filter((path) => !pending.has(path))
  const updates = buildFileTreePathUpdates(previous, [...target]).filter((update) => {
    if (update.type === "add") return !held.has(update.path)
    if (update.type === "remove") return !pending.has(update.path)
    return false
  })
  if (!updates.length) return new Set(target)
  try {
    tree.batch(updates)
  } catch {
    for (const update of updates) {
      try {
        if (update.type === "add") tree.add(update.path)
        else if (update.type === "remove") tree.remove(update.path, { recursive: true })
      } catch {}
    }
  }
  return new Set(target)
}
