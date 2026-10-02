import { ramp, traits } from "blobatar"

/*
 * One source of truth for how an identity looks. The seed is the agent's slug
 * for an agent, and the room id for a group or a chat with no agent. Never a
 * display name, an index, a random value, or a chat title: those change, and
 * then the same bot looks different in each place that draws it.
 *
 * The blobatar shape and colours come from the blobatar package, seeded with the
 * same string. An agent's colour is its blob's own head colour, lifted so it
 * reads as text on the dark palette, so its name, its mention chips and its
 * reply quotes match its face.
 *
 * DEVIATION: the plan picked the colour from a fixed set of kat tokens. A token
 * next to a blob of an unrelated hue reads as two identities, and the reference
 * (`docs/reference/group-chat/01.png`) tints a mention in its avatar's colour.
 * kat's palette is dark only, so one lightness floor serves every theme.
 */

/** The lowest OKLCH lightness an identity colour gets, so it reads on a dark bubble. */
const MIN_LIGHTNESS = 0.72

export type IdentityLook = {
  /** The string handed to the blobatar. Equal to the seed. */
  seed: string
  /** A CSS colour: the blob's head colour, lifted for text on the dark palette. */
  color: string
}

const looks = new Map<string, IdentityLook>()

export function identityLook(seed: string): IdentityLook {
  let look = looks.get(seed)
  if (look) return look
  // The same traits and ramp the blobatar resolves, so the colour is the head's own.
  const t = traits(seed, true)
  const head = ramp(t.num("hue", 0, 360), true, t("tone")).head!
  const l = Math.max(head.l, MIN_LIGHTNESS)
  look = { seed, color: `oklch(${l.toFixed(3)} ${head.c.toFixed(3)} ${head.h.toFixed(1)})` }
  looks.set(seed, look)
  return look
}

/** An identity's colour mixed into transparency, for a chip or a quote background. */
export const identityTint = (seed: string, percent: number) =>
  `color-mix(in oklch, ${identityLook(seed).color} ${percent}%, transparent)`

/** The agent a chat made without a pick talks to. It matches the server's `DEFAULT_AGENT`. */
export const DEFAULT_AGENT_SLUG = "kiko"

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
  const slugs = members?.length ? [...members] : (chat.agents ?? []).map((id) => slugOf(id, agents))
  if (slugs.length > 1) return slugs.slice(0, MAX_FACES)
  return [slugs[0] ?? DEFAULT_AGENT_SLUG]
}
