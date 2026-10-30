import type { FileTreeBatchOperation } from "@pierre/trees"

const depth = (path: string) => path.split("/").filter(Boolean).length

export function buildFileTreePathUpdates(
  previousPaths: readonly string[],
  nextPaths: readonly string[],
): FileTreeBatchOperation[] {
  const previous = new Set(previousPaths)
  const next = new Set(nextPaths)
  const removedRoots: string[] = []
  const updates: FileTreeBatchOperation[] = []

  const removed = previousPaths.filter((path) => !next.has(path)).toSorted((left, right) => depth(left) - depth(right))
  for (const path of removed) {
    if (removedRoots.some((directory) => path.startsWith(directory))) continue
    const recursive = path.endsWith("/")
    updates.push({ type: "remove", path, ...(recursive ? { recursive: true } : {}) })
    if (recursive) removedRoots.push(path)
  }

  const added = nextPaths.filter((path) => !previous.has(path)).toSorted((left, right) => depth(left) - depth(right))
  for (const path of added) updates.push({ type: "add", path })

  return updates
}
