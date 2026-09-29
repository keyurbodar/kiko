export function getFilename(path: string) {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
}

export function getFilenameTruncated(path: string, max: number) {
  const filename = getFilename(path)
  if (filename.length <= max) return filename
  return "…" + filename.slice(filename.length - max + 1)
}
