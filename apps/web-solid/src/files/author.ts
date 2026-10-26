import type { AgentSlug, RoomId } from "@kiko/protocol"

export type Author = "all" | "you" | `agent:${string}` | `chat:${string}`

type Authored = { madeBy: AgentSlug | null; roomId: RoomId | null }

export type AuthorFacets = {
  you: number
  agents: readonly { slug: AgentSlug; count: number }[]
  chats: readonly { roomId: RoomId; count: number }[]
}

function tally<K>(keys: readonly K[]): { key: K; count: number }[] {
  const counts = new Map<K, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

export function authorFacets(files: readonly Authored[]): AuthorFacets {
  return {
    you: files.filter((f) => f.madeBy === null).length,
    agents: tally(files.flatMap((f) => (f.madeBy ? [f.madeBy] : []))).map(({ key, count }) => ({ slug: key, count })),
    chats: tally(files.flatMap((f) => (f.roomId ? [f.roomId] : []))).map(({ key, count }) => ({ roomId: key, count })),
  }
}

export function byAuthor(author: Author, file: Authored): boolean {
  if (author === "all") return true
  if (author === "you") return file.madeBy === null
  if (author.startsWith("agent:")) return file.madeBy === author.slice(6)
  return file.roomId === author.slice(5)
}

export function knownAuthor(author: Author, facets: AuthorFacets): Author {
  if (author === "all") return author
  if (author === "you") return facets.you > 0 ? author : "all"
  if (author.startsWith("agent:")) return facets.agents.some((a) => a.slug === author.slice(6)) ? author : "all"
  return facets.chats.some((c) => c.roomId === author.slice(5)) ? author : "all"
}
