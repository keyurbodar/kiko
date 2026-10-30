export interface DirectoryHandle {
  isDirectory(): boolean
  isExpanded(): boolean
  expand(): void
  collapse(): void
}

export interface ExpansionModel {
  getItem(path: string): unknown
}

function asDirectoryHandle(item: unknown): DirectoryHandle | null {
  if (typeof item !== "object" || item === null) return null
  const handle = item as Partial<DirectoryHandle>
  if (
    typeof handle.isDirectory !== "function" ||
    typeof handle.isExpanded !== "function" ||
    typeof handle.expand !== "function" ||
    typeof handle.collapse !== "function" ||
    !handle.isDirectory()
  )
    return null
  return handle as DirectoryHandle
}

export function areAllDirectoriesExpanded(model: ExpansionModel, directoryPaths: readonly string[]): boolean {
  return (
    directoryPaths.length > 0 &&
    directoryPaths.every((path) => {
      const handle = asDirectoryHandle(model.getItem(path))
      return handle !== null && handle.isExpanded()
    })
  )
}

export function setAllDirectoriesExpanded(
  model: ExpansionModel,
  directoryPaths: readonly string[],
  expanded: boolean,
): void {
  for (const path of directoryPaths) {
    const handle = asDirectoryHandle(model.getItem(path))
    if (handle === null || handle.isExpanded() === expanded) continue
    if (expanded) handle.expand()
    else handle.collapse()
  }
}
