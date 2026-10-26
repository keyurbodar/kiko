import type { Agent, Chat, RowKind, UserEvent, UserSignal, UserSnapshot } from "@kiko/protocol"
import type { StreamReducer } from "./stream"

const upsert = <T>(list: ReadonlyArray<T>, item: T, same: (x: T) => boolean): T[] => {
  const index = list.findIndex(same)
  return index === -1 ? [...list, item] : list.map((x, i) => (i === index ? item : x))
}

type Rows = NonNullable<UserSnapshot["rows"]>

const withRow = (
  rows: Rows | undefined,
  kind: RowKind,
  update: (list: ReadonlyArray<{ id: string }>) => unknown[],
) => ({
  ...rows,
  [kind]: update((rows?.[kind] ?? []) as ReadonlyArray<{ id: string }>),
})

function applyDirectoryEvent(snapshot: UserSnapshot, event: UserEvent): UserSnapshot {
  switch (event.t) {
    case "chat":
      return { ...snapshot, chats: upsert<Chat>(snapshot.chats, event.chat, (c) => c.roomId === event.chat.roomId) }
    case "chat_removed":
      return { ...snapshot, chats: snapshot.chats.filter((c) => c.roomId !== event.roomId) }
    case "agent":
      return { ...snapshot, agents: upsert<Agent>(snapshot.agents ?? [], event.agent, (a) => a.id === event.agent.id) }
    case "agent_removed":
      return { ...snapshot, agents: (snapshot.agents ?? []).filter((a) => a.id !== event.id) }
    case "agent_model": {
      const { seq: _, at: __, t: ___, slug, ...model } = event
      return { ...snapshot, agentModels: { ...snapshot.agentModels, [slug]: model } }
    }
    case "theme":
      return { ...snapshot, theme: event.theme }
    default:
      return snapshot
  }
}

function applyHomeEvent(snapshot: UserSnapshot, event: UserEvent): UserSnapshot {
  switch (event.t) {
    case "file": {
      const files = snapshot.home.files.filter((f) => f.name !== event.file.name || f.id === event.file.id)
      return {
        ...snapshot,
        home: { ...snapshot.home, files: upsert(files, event.file, (f) => f.id === event.file.id) },
      }
    }
    case "file_removed":
      return {
        ...snapshot,
        home: { ...snapshot.home, files: snapshot.home.files.filter((f) => !event.ids.includes(f.id)) },
      }
    case "folders":
      return { ...snapshot, home: { ...snapshot.home, folders: [...event.folders] } }
    case "row":
      return {
        ...snapshot,
        rows: withRow(snapshot.rows, event.kind, (list) => upsert(list, event.row, (r) => r.id === event.row.id)),
      }
    case "row_removed":
      return { ...snapshot, rows: withRow(snapshot.rows, event.kind, (list) => list.filter((r) => r.id !== event.id)) }
    default:
      return applyDirectoryEvent(snapshot, event)
  }
}

function applyUserEvent(snapshot: UserSnapshot, event: UserEvent, sequence: number): UserSnapshot {
  return { ...applyHomeEvent(snapshot, event), seq: sequence }
}

export const userReducer: StreamReducer<UserSnapshot, UserEvent, UserSignal> = {
  snapshotSequence: (snapshot) => snapshot.seq,
  applyEvent: applyUserEvent,
  unsequenced: (event) => event.t === "chat" && event.projection === true,
}
