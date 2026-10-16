/*
 * A file dragged out of the Files tree or out of a chat file chip carries its workspace path under
 * its own type, as t3code's tree drag does, so the composer can tell it from a file dragged in
 * from the desktop and from selected text. No Solid.
 */

export const FILE_DRAG_TYPE = "application/x-kiko-file"

type Transfer = Pick<DataTransfer, "types" | "getData">

/** Marks a drag as carrying the file at `path` (no leading slash). */
export function setFileDrag(transfer: DataTransfer, path: string): void {
  transfer.setData(FILE_DRAG_TYPE, path)
  // The tree starts its own drags as "move"; a copy drop would otherwise be refused.
  transfer.effectAllowed = "copyMove"
}

export function hasFileDrag(transfer: Pick<DataTransfer, "types"> | null | undefined): boolean {
  return !!transfer && Array.from(transfer.types).includes(FILE_DRAG_TYPE)
}

/** The path a drop carries, or null when it is not a file drag or names a folder. */
export function droppedFilePath(transfer: Transfer | null | undefined): string | null {
  if (!transfer || !hasFileDrag(transfer)) return null
  const path = transfer.getData(FILE_DRAG_TYPE).replace(/^\/+/, "")
  return path && !path.endsWith("/") ? path : null
}
