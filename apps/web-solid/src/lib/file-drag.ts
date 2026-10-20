export const FILE_DRAG_TYPE = "application/x-kiko-file"

type Transfer = Pick<DataTransfer, "types" | "getData">

export function setFileDrag(transfer: DataTransfer, path: string): void {
  transfer.setData(FILE_DRAG_TYPE, path)
  transfer.effectAllowed = "copyMove"
}

export function hasFileDrag(transfer: Pick<DataTransfer, "types"> | null | undefined): boolean {
  return !!transfer && Array.from(transfer.types).includes(FILE_DRAG_TYPE)
}

export function droppedFilePath(transfer: Transfer | null | undefined): string | null {
  if (!transfer || !hasFileDrag(transfer)) return null
  const path = transfer.getData(FILE_DRAG_TYPE).replace(/^\/+/, "")
  return path || null
}
