import type { AgentSlug } from "@kiko/protocol"

// Architecture section 7.12. Agents share one chat and one file space, so without a shared picture
// they race: two answer the same question, two rewrite the same file. The room is where every
// visible act already passes, so it keeps the picture:
//
// - what each agent is doing right now ("editing /hello.html", "messaging @ada"), from the acts
//   themselves, so an agent never has to remember to report; shown in every brief and to the human
// - leases: the paths an agent changed during its current run are its own until the run ends. A
//   teammate's write there is refused with who holds it, so it waits or messages them. Reads stay
//   open, the human is never refused, and a lease left by a crashed run expires.
//
// Both are cleared when the agent goes idle.

/** ASSUMPTION: a lease outlives a run that never reported its end by this long. */
export const LEASE_MS = 10 * 60_000
/** Shared on purpose: the whole team keeps it, and its writes are already hash-checked. */
const UNLEASED = new Set(["chat.md"])

export type Holder = { slug: AgentSlug; path: string; doing: string | null }

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`) || p.startsWith(`${path}/`)

export class Team {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS team_doing (slug TEXT PRIMARY KEY, doing TEXT NOT NULL, at INTEGER NOT NULL)")
    sql.exec("CREATE TABLE IF NOT EXISTS team_leases (path TEXT PRIMARY KEY, slug TEXT NOT NULL, at INTEGER NOT NULL)")
  }

  /** What `slug` is doing now, in a few words. */
  doing(slug: AgentSlug, text: string, now: number): void {
    this.sql.exec("INSERT INTO team_doing (slug, doing, at) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET doing = excluded.doing, at = excluded.at", slug, text, now)
  }

  /** The run ended: nothing doing, nothing held. */
  clear(slug: AgentSlug): void {
    this.sql.exec("DELETE FROM team_doing WHERE slug = ?", slug)
    this.sql.exec("DELETE FROM team_leases WHERE slug = ?", slug)
  }

  /** Another agent's live lease on any of `paths` (a folder covers what is under it), or null. */
  holder(slug: AgentSlug, paths: readonly string[], now: number): Holder | null {
    const live = this.sql.exec<{ path: string; slug: string }>("SELECT path, slug FROM team_leases WHERE slug != ? AND at > ?", slug, now - LEASE_MS).toArray()
    for (const p of paths) {
      const hit = live.find((l) => under(l.path, p))
      if (hit) return { slug: hit.slug as AgentSlug, path: hit.path, doing: this.now(hit.slug as AgentSlug) }
    }
    return null
  }

  /** `slug` holds these paths until its run ends. */
  take(slug: AgentSlug, paths: readonly string[], now: number): void {
    for (const p of paths) {
      if (!p || UNLEASED.has(p)) continue
      this.sql.exec("INSERT INTO team_leases (path, slug, at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET slug = excluded.slug, at = excluded.at", p, slug, now)
    }
  }

  now(slug: AgentSlug): string | null {
    return this.sql.exec<{ doing: string }>("SELECT doing FROM team_doing WHERE slug = ?", slug).toArray()[0]?.doing ?? null
  }

  /** The paths `slug` holds now. */
  held(slug: AgentSlug, now: number): string[] {
    return this.sql.exec<{ path: string }>("SELECT path FROM team_leases WHERE slug = ? AND at > ? ORDER BY path", slug, now - LEASE_MS).toArray().map((r) => r.path)
  }

  /** The refusal a teammate reads when it reaches for a held path. */
  static refusal(h: Holder): string {
    return `@${h.slug} is working on /${h.path} right now${h.doing ? ` (${h.doing})` : ""}. it is theirs until they finish: wait, or send_message @${h.slug} about it. don't work around it with a copy.`
  }
}
