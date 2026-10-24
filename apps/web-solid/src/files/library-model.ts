import type { AgentSlug, FileRef, OwnerFile, RoomId } from "@kiko/protocol"
import { HOME, isHidden } from "./model"

export type LibraryFile = {
  key: string
  space: string
  roomId: RoomId | null
  path: string
  file: FileRef
  madeBy: AgentSlug | null
  at: number
}

type Listed = Pick<OwnerFile, "madeBy" | "at">

const keyOf = (space: string, name: string) => `${space}:${name}`

export function mergeLibrary(input: {
  listed: readonly OwnerFile[]
  home: readonly FileRef[]
  activeId: RoomId | null
  active: readonly FileRef[]
  chats: ReadonlySet<string>
}): LibraryFile[] {
  const facts = new Map<string, Listed>()
  for (const f of input.listed) facts.set(f.file.id, f)
  const fresh = Number.MAX_SAFE_INTEGER
  const live = (space: string, roomId: RoomId | null, files: readonly FileRef[]): LibraryFile[] =>
    files.map((file) => ({
      key: keyOf(space, file.name),
      space,
      roomId,
      path: roomId === null ? `${HOME}/${file.name}` : file.name,
      file,
      madeBy: facts.get(file.id)?.madeBy ?? null,
      at: facts.get(file.id)?.at ?? fresh,
    }))
  const others = input.listed.flatMap((f): LibraryFile[] =>
    f.roomId === null || f.roomId === input.activeId || !input.chats.has(f.roomId)
      ? []
      : [{ key: keyOf(f.roomId, f.file.name), space: f.roomId, path: f.file.name, ...f }],
  )
  const active = input.activeId === null ? [] : live(input.activeId, input.activeId, input.active)
  return [...live(HOME, null, input.home), ...active, ...others].filter((f) => !isHidden(f.file.name))
}
