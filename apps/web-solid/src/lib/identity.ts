import { FLAVOURS, resolve } from "@kiko/avatar"
import { KIKO } from "@kiko/protocol"
import { pinsFor } from "../avatar/picks"

/*
 * One source of truth for how an identity looks. The seed is the agent's slug
 * for an agent, and the room id for a group or a chat with no agent. Never a
 * display name, an index, a random value, or a chat title: those change, and
 * then the same bot looks different in each place that draws it.
 *
 * The face is an avatar from `@kiko/avatar`, drawn from the same seed unless the
 * person picked one. An agent's colour comes from its flavor, kept readable on
 * both appearances, so its name, its mention chips and its reply quotes match
 * its face. Kiko's colour is the theme accent.
 */

export type IdentityLook = {
  /** The seed the avatar is drawn from. */
  seed: string
  /** A CSS colour: the flavor's colour, readable as text on the current appearance. */
  color: string
}

/** Reactive: a choice the person makes changes the colour everywhere it is read. */
export function identityLook(seed: string): IdentityLook {
  return { seed, color: inkColor(seed) }
}

function inkColor(seed: string): string {
  if (seed === KIKO) return "var(--accent)"
  const grain = FLAVOURS[resolve(seed, pinsFor(seed)).flavour].grain
  return `light-dark(color-mix(in oklch, ${grain}, #000 45%), color-mix(in oklch, ${grain}, #fff 30%))`
}

/** An identity's colour mixed into transparency, for a chip or a quote background. */
export const identityTint = (seed: string, percent: number) =>
  `color-mix(in oklch, ${identityLook(seed).color} ${percent}%, transparent)`

/** The agent a chat made without a pick talks to. It matches the server's `DEFAULT_AGENT`. */
export const DEFAULT_AGENT_SLUG = "yuki"

type ChatAgents = { roomId: string; agents?: readonly string[] }
type AgentIds = readonly { id: string; slug: string }[]

/** An agent id from `Chat.agents` as a slug. The built-in agent's id is its slug. */
const slugOf = (id: string, agents: AgentIds) => agents.find((a) => a.id === id)?.slug ?? id

/**
 * The seed for a chat's avatar. A chat with one agent wears that agent's face, as a Telegram
 * chat with a bot shows the bot, so the same bot looks the same in the chat list, the tab,
 * the header, the members list, and its bubbles. Only a group has a face of its own.
 */
export function chatSeed(chat: ChatAgents, agents: AgentIds): string {
  const ids = chat.agents ?? []
  if (ids.length > 1) return chat.roomId
  if (!ids.length) return DEFAULT_AGENT_SLUG
  return slugOf(ids[0]!, agents)
}

/** A group's stacked avatar shows at most this many members. */
export const MAX_FACES = 3

/**
 * The faces a chat's avatar draws. One seed for a chat with one agent. For a group, up to
 * three member slugs in the order they joined, so a group is known by who is in it rather
 * than by a blob of its own. `members` is the open room's live list; it wins over the ids
 * the chat was made with, because agents join and leave after that.
 */
export function chatFaces(chat: ChatAgents, agents: AgentIds, members?: readonly string[]): string[] {
  let slugs = members?.length ? [...members] : (chat.agents ?? []).map((id) => slugOf(id, agents))
  // The room seeds kiko as the chief of every group, so a closed group shows it too and does not
  // change its faces when it opens.
  if (!members?.length && slugs.length > 1 && !slugs.includes(DEFAULT_AGENT_SLUG)) slugs = [DEFAULT_AGENT_SLUG, ...slugs]
  if (slugs.length > 1) return slugs.slice(0, MAX_FACES)
  return [slugs[0] ?? DEFAULT_AGENT_SLUG]
}
