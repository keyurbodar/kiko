import type { Actor, AgentStatus, Message, MessageId, RoomEvent, RoomSignal, RoomSnapshot } from "@kiko/protocol"
import type { StreamReducer } from "./stream"

const upsert = <T>(list: ReadonlyArray<T>, item: T, same: (x: T) => boolean): T[] => {
  const index = list.findIndex(same)
  return index === -1 ? [...list, item] : list.map((x, i) => (i === index ? item : x))
}

const sameActor = (a: Actor, b: Actor) =>
  a.kind === "human" ? b.kind === "human" : b.kind === "agent" && a.slug === b.slug

const updateMessage = (snapshot: RoomSnapshot, id: MessageId, update: (message: Message) => Message): RoomSnapshot => ({
  ...snapshot,
  messages: snapshot.messages.map((m) => (m.id === id ? update(m) : m)),
})

function messageIndex(messages: ReadonlyArray<Message>, id: MessageId): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i]!.id === id) return i
  return -1
}

function putMessage(messages: ReadonlyArray<Message>, message: Message): Message[] {
  const index = messageIndex(messages, message.id)
  if (index !== -1) {
    const next = messages.slice()
    next[index] = message
    return next
  }
  const after = messages.findIndex((m) => m.seq > message.seq)
  return after === -1 ? [...messages, message] : [...messages.slice(0, after), message, ...messages.slice(after)]
}

function deleteMessages(snapshot: RoomSnapshot, ids: ReadonlyArray<MessageId>): RoomSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages
      .filter((m) => !ids.includes(m.id))
      .map((m) =>
        m.replyTo && m.reply && ids.includes(m.replyTo)
          ? { ...m, reply: { seq: m.reply.seq, from: m.reply.from, text: "", gone: true as const } }
          : m,
      ),
  }
}

function applyMessageEvent(snapshot: RoomSnapshot, event: RoomEvent): RoomSnapshot {
  switch (event.t) {
    case "message": {
      const { t: _, ...message } = event
      return { ...snapshot, messages: putMessage(snapshot.messages, message) }
    }
    case "edit":
      return updateMessage(snapshot, event.messageId, (message) => {
        const { rich: _, ...rest } = message
        return { ...rest, text: event.text, editedAt: event.at, ...(event.rich ? { rich: event.rich } : {}) }
      })
    case "delete":
      return deleteMessages(snapshot, event.messageIds)
    case "react":
      return updateMessage(snapshot, event.messageId, (message) => {
        const { reactions: before, ...rest } = message
        const reactions = (before ?? []).filter((r) => !sameActor(r.by, event.by))
        if (event.emoji !== null) reactions.push({ by: event.by, emoji: event.emoji })
        return reactions.length ? { ...rest, reactions } : rest
      })
    default:
      return snapshot
  }
}

function applyMetaEvent(snapshot: RoomSnapshot, event: RoomEvent): RoomSnapshot {
  switch (event.t) {
    case "read":
      return { ...snapshot, readSeq: Math.max(snapshot.readSeq, event.upTo) }
    case "member":
      return { ...snapshot, members: upsert(snapshot.members, event.member, (m) => m.slug === event.member.slug) }
    case "member_removed":
      return { ...snapshot, members: snapshot.members.filter((m) => m.slug !== event.slug) }
    case "task":
      return { ...snapshot, tasks: upsert(snapshot.tasks, event.task, (t) => t.id === event.task.id) }
    case "task_removed":
      return { ...snapshot, tasks: snapshot.tasks.filter((t) => t.id !== event.id) }
    case "file": {
      const files = snapshot.files.filter((f) => f.name !== event.file.name || f.id === event.file.id)
      return { ...snapshot, files: upsert(files, event.file, (f) => f.id === event.file.id) }
    }
    case "file_removed":
      return { ...snapshot, files: snapshot.files.filter((f) => !event.ids.includes(f.id)) }
    case "folders":
      return { ...snapshot, folders: [...event.folders] }
    case "ask": {
      const { t: _, seq: __, at: ___, ...ask } = event
      return { ...snapshot, asks: upsert(snapshot.asks ?? [], ask, (a) => a.id === ask.id) }
    }
    case "ask_resolved":
      return { ...snapshot, asks: (snapshot.asks ?? []).filter((a) => a.id !== event.id) }
    default:
      return applyMessageEvent(snapshot, event)
  }
}

function applyRoomEvent(snapshot: RoomSnapshot, event: RoomEvent, sequence: number): RoomSnapshot {
  return { ...applyMetaEvent(snapshot, event), seq: sequence }
}

function applyStatus(snapshot: RoomSnapshot, status: AgentStatus): RoomSnapshot {
  const agents = snapshot.agents ?? []
  return {
    ...snapshot,
    agents:
      status.state === "idle"
        ? agents.filter((a) => a.slug !== status.slug)
        : upsert(agents, status, (a) => a.slug === status.slug),
  }
}

function applyRoomSignal(snapshot: RoomSnapshot, signal: RoomSignal): RoomSnapshot {
  if (signal.t !== "status") return snapshot
  const { t: _, ...status } = signal
  return applyStatus(snapshot, status)
}

export const roomReducer: StreamReducer<RoomSnapshot, RoomEvent, RoomSignal> = {
  snapshotSequence: (snapshot) => snapshot.seq,
  applyEvent: applyRoomEvent,
  applySignal: applyRoomSignal,
}
