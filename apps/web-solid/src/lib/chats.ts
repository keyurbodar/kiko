import { type Agent, type AgentSlug, type Chat, KIKO, KIKO_HOME_ROOM, type RoomId } from "@kiko/protocol"

export const BUILTIN_AGENT: Agent = { id: KIKO, name: "Kiko", slug: KIKO as AgentSlug, prompt: "", model: "" }

export function agentList(stored: readonly Agent[]): Agent[] {
  return [BUILTIN_AGENT, ...stored.filter((a) => a.id !== BUILTIN_AGENT.id)]
}

export function kikoPlaceholder(now: number): Chat {
  return { roomId: KIKO_HOME_ROOM, title: "Kiko", pinned: true, muted: false, lastSeq: 0, lastPreview: "", unread: 0, updatedAt: now, agents: [KIKO], kiko: true }
}

export function rosterChats(chats: readonly Chat[]): Chat[] {
  const kiko = chats.findIndex((c) => c.kiko)
  return kiko > 0 ? [chats[kiko]!, ...chats.slice(0, kiko), ...chats.slice(kiko + 1)] : [...chats]
}

export function resumeChat(chats: readonly Chat[], loaded: boolean, wanted: readonly (string | null | undefined)[]): RoomId | null {
  if (!loaded) return (wanted.find(Boolean) as RoomId | undefined) ?? null
  for (const id of wanted) {
    const chat = id ? chats.find((c) => c.roomId === id) : undefined
    if (chat) return chat.roomId
  }
  return chats.find((c) => c.kiko)?.roomId ?? (chats.length ? null : KIKO_HOME_ROOM)
}

export function chatAfter(ids: readonly string[], id: string): string | null {
  const at = ids.indexOf(id)
  const rest = ids.filter((other) => other !== id)
  return rest[at] ?? rest[at - 1] ?? null
}

export function distinctTitles(chats: readonly Chat[]): Chat[] {
  const seen = new Map<string, number>()
  const suffix = new Map<string, string>()
  for (const c of [...chats].sort((a, b) => (a.roomId < b.roomId ? -1 : 1))) {
    const key = c.title.trim().toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n > 1) suffix.set(c.roomId, `${c.title.trim()} ${n}`)
  }
  return suffix.size ? chats.map((c) => (suffix.has(c.roomId) ? { ...c, title: suffix.get(c.roomId)! } : c)) : [...chats]
}
