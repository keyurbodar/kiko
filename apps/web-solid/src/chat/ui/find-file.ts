import { room } from "../../state/room"
import { user } from "../../state/user"
import { resolveFile, type Resolved } from "../rich/file-links"

export function findFile(path: string): Resolved {
  const own = resolveFile(
    path,
    room.files().map((f) => f.name),
  )
  return own.kind !== "none"
    ? own
    : resolveFile(
        path,
        user.homeFiles().map((f) => `home/${f.name}`),
      )
}
