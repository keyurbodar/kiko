import { type Agent, type AgentSlug, type Chat, dmFor, KIKO, kikoOnly, type RoomId } from "@kiko/protocol"

/*
 * The pure rules of the chat list (architecture section 7.11): which chats the sidebar shows, and
 * which chat the app opens when the URL names none. The store and the routes only call these.
 */

/** The agent every user has. It is not stored, so it is never missing. */
export const BUILTIN_AGENT: Agent = { id: KIKO, name: "Kiko", slug: KIKO as AgentSlug, prompt: "", model: "" }

/** The user's agents with the built-in one first. */
export function agentList(stored: readonly Agent[]): Agent[] {
  return [BUILTIN_AGENT, ...stored.filter((a) => a.id !== BUILTIN_AGENT.id)]
}

/**
 * The chats the sidebar lists, in its order. Left out: rooms with kiko alone that are not the kiko
 * chat (old drafts and second kiko chats), and every direct chat with an agent but the one that
 * counts. The kiko chat comes first; it is the first pinned tile. Otherwise the order is kept.
 */
export function rosterChats(chats: readonly Chat[]): Chat[] {
  const out = chats.filter((c) => {
    if (c.kiko) return true
    if (kikoOnly(c)) return false
    const agent = c.agents?.length === 1 ? c.agents[0]! : null
    return agent === null || dmFor(chats, agent)?.roomId === c.roomId
  })
  const kiko = out.findIndex((c) => c.kiko)
  if (kiko > 0) out.unshift(...out.splice(kiko, 1))
  return out
}

/**
 * The chat to open when the URL names none. The first of `wanted` (this device's last chat, then
 * the server's) that is in the list, else the kiko chat. Before the list has
 * loaded, this device's last chat is trusted, so the first paint never waits; the chat route sends
 * the reader on if it turns out to be gone.
 */
export function resumeChat(chats: readonly Chat[], loaded: boolean, wanted: readonly (string | null | undefined)[]): RoomId | null {
  if (!loaded) return (wanted.find(Boolean) as RoomId | undefined) ?? null
  for (const id of wanted) {
    const chat = id ? chats.find((c) => c.roomId === id) : undefined
    if (chat) return chat.roomId
  }
  return chats.find((c) => c.kiko)?.roomId ?? null
}

/** The chat that takes `id`'s place in a list once it leaves: the one below it, else the one above, else none. */
export function chatAfter(ids: readonly string[], id: string): string | null {
  const at = ids.indexOf(id)
  const rest = ids.filter((other) => other !== id)
  return rest[at] ?? rest[at - 1] ?? null
}
