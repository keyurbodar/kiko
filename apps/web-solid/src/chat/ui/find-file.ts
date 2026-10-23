import { useApp } from "../../lib/store"
import { resolveFile, type Resolved } from "../rich/file-links"

export function findFile(path: string): Resolved {
  const own = resolveFile(
    path,
    useApp.activeFiles().map((f) => f.name),
  )
  return own.kind !== "none"
    ? own
    : resolveFile(
        path,
        useApp.homeFiles().map((f) => `home/${f.name}`),
      )
}
