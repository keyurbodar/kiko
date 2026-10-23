import type { Activity, AgentSlug } from "@kiko/protocol"

const LEASE_MS = 10 * 60_000
const UNLEASED = new Set(["chat.md"])

export type Holder = { slug: AgentSlug; path: string; doing: string | null }

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`) || p.startsWith(`${path}/`)

export class Team {
  private readonly activities = new Map<AgentSlug, { text: string; activity: Activity }>()
  constructor(
    private readonly sql: SqlStorage,
    private readonly roomId: string,
  ) {}

  doing(slug: AgentSlug, text: string, now: number, activity: Activity): void {
    this.activities.set(slug, { text, activity })
  }
  activity(slug: AgentSlug): Activity | null {
    return this.activities.get(slug)?.activity ?? null
  }
  clearDoing(slug: AgentSlug): void {
    this.activities.delete(slug)
  }
  clear(slug: AgentSlug): void {
    this.activities.delete(slug)
    this.sql.exec("DELETE FROM team_leases WHERE slug = ?1 AND team_leases.room_id = ?2", slug, this.roomId)
  }

  holder(slug: AgentSlug, paths: readonly string[], now: number): Holder | null {
    const live = this.sql
      .exec<{ path: string; slug: string }>(
        "SELECT path, slug FROM team_leases WHERE (slug <> ?1 AND at > ?2) AND team_leases.room_id = ?3",
        slug,
        now - LEASE_MS,
        this.roomId,
      )
      .toArray()
    for (const p of paths) {
      const hit = live.find((l) => under(l.path, p))
      if (hit) return { slug: hit.slug as AgentSlug, path: hit.path, doing: this.now(hit.slug as AgentSlug) }
    }
    return null
  }

  take(slug: AgentSlug, paths: readonly string[], now: number): void {
    for (const p of paths) {
      if (!p || UNLEASED.has(p)) continue
      this.sql.exec(
        "INSERT INTO team_leases (path, slug, at, room_id) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(path, room_id) DO UPDATE SET slug = excluded.slug, at = excluded.at",
        p,
        slug,
        now,
        this.roomId,
      )
    }
  }

  now(slug: AgentSlug): string | null {
    return this.activities.get(slug)?.text ?? null
  }

  held(slug: AgentSlug, now: number): string[] {
    return this.sql
      .exec<{ path: string }>(
        "SELECT path FROM team_leases WHERE (slug = ?1 AND at > ?2) AND team_leases.room_id = ?3 ORDER BY path",
        slug,
        now - LEASE_MS,
        this.roomId,
      )
      .toArray()
      .map((r) => r.path)
  }

  static refusal(h: Holder): string {
    return `@${h.slug} is working on /${h.path} right now${h.doing ? ` (${h.doing})` : ""}. it is theirs until they finish: wait, or send_message @${h.slug} about it. don't work around it with a copy.`
  }
}
