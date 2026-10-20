import type { Activity, AgentSlug } from "@kiko/protocol"

/** ASSUMPTION: a lease outlives a run that never reported its end by this long. */
export const LEASE_MS = 10 * 60_000
/** Shared on purpose: the whole team keeps it, and its writes are already hash-checked. */
const UNLEASED = new Set(["chat.md"])

export type Holder = { slug: AgentSlug; path: string; doing: string | null }

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`) || p.startsWith(`${path}/`)

export class Team {
  private readonly activities=new Map<AgentSlug,{text:string;activity:Activity}>()
  constructor(private readonly sql: SqlStorage) {
  }

  doing(slug: AgentSlug, text: string, now: number, activity: Activity): void {
    this.activities.set(slug,{text,activity})
  }
  activity(slug:AgentSlug):Activity|null{return this.activities.get(slug)?.activity??null}
  clearDoing(slug:AgentSlug):void{this.activities.delete(slug)}
  clear(slug:AgentSlug):void{this.activities.delete(slug);this.sql.exec("DELETE FROM team_leases WHERE slug = ?",slug)}

  holder(slug: AgentSlug, paths: readonly string[], now: number): Holder | null {
    const live = this.sql.exec<{ path: string; slug: string }>("SELECT path, slug FROM team_leases WHERE slug != ? AND at > ?", slug, now - LEASE_MS).toArray()
    for (const p of paths) {
      const hit = live.find((l) => under(l.path, p))
      if (hit) return { slug: hit.slug as AgentSlug, path: hit.path, doing: this.now(hit.slug as AgentSlug) }
    }
    return null
  }

  take(slug: AgentSlug, paths: readonly string[], now: number): void {
    for (const p of paths) {
      if (!p || UNLEASED.has(p)) continue
      this.sql.exec("INSERT INTO team_leases (path, slug, at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET slug = excluded.slug, at = excluded.at", p, slug, now)
    }
  }

  now(slug: AgentSlug): string | null {
    return this.activities.get(slug)?.text??null
  }

  held(slug: AgentSlug, now: number): string[] {
    return this.sql.exec<{ path: string }>("SELECT path FROM team_leases WHERE slug = ? AND at > ? ORDER BY path", slug, now - LEASE_MS).toArray().map((r) => r.path)
  }

  static refusal(h: Holder): string {
    return `@${h.slug} is working on /${h.path} right now${h.doing ? ` (${h.doing})` : ""}. it is theirs until they finish: wait, or send_message @${h.slug} about it. don't work around it with a copy.`
  }
}
