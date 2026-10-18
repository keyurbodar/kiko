import { useApp } from "../../lib/store"
import { resolveFile, type Resolved } from "../rich/file-links"

/** Where a named file is: the chat's own files first, then the user's home drive. */
export function findFile(path: string): Resolved {
  const own = resolveFile(path, useApp.activeFiles().map((f) => f.name))
  return own.kind !== "none" ? own : resolveFile(path, useApp.homeFiles().map((f) => `home/${f.name}`))
}
