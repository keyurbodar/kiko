import type { Agent, Member } from "@yuki/protocol"
import { BUILTIN_AGENT } from "../lib/chats"

/*
 * The pure part of the "to:" bar: who its chips are and who the search finds. The component
 * holds only state.
 */

export type ToChip = { slug: string; name: string; removable: boolean }

/**
 * The chips: the room's members, or the agents the chat was made with until the room has
 * seeded them. yuki leads every room and stays in it, so its chip comes off only when it is
 * alone in an empty chat, where taking it off means "a chat with someone else". Another agent
 * comes off while one more stays.
 */
export function toChips(input: { members: readonly Member[]; chatAgents: readonly string[]; agents: readonly Agent[]; yukiOff: boolean; empty: boolean }): ToChip[] {
  const here = input.members.length
    ? input.members.map((m) => ({ slug: m.slug as string, name: m.name }))
    : input.chatAgents.flatMap((id) => {
        const a = input.agents.find((x) => x.id === id)
        return a ? [{ slug: a.slug as string, name: a.name }] : []
      })
  const shown = input.yukiOff ? here.filter((c) => c.slug !== BUILTIN_AGENT.slug) : here
  return shown.map((c) => ({ ...c, removable: c.slug === BUILTIN_AGENT.slug ? input.empty && shown.length === 1 : shown.length > 1 }))
}

/** The agents not in the chat whose name or handle matches `query`. A leading @ searches handles only. */
export function pickerMatches(agents: readonly Agent[], inChat: readonly string[], query: string): Agent[] {
  const q = query.trim().toLowerCase()
  const handle = q.startsWith("@")
  const word = handle ? q.slice(1) : q
  return agents.filter((a) => {
    if (inChat.includes(a.slug)) return false
    if (!word) return true
    return a.slug.toLowerCase().includes(word) || (!handle && a.name.toLowerCase().includes(word))
  })
}
