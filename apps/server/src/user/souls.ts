// Architecture section 7.10. Each of the user's agents has a soul: one short markdown file that says
// who it is and how it works with this person. The agent reads it in its system prompt on every
// request and keeps it current itself, at /me/soul.md; the human edits it in the app. It lives in
// UserDO, so an agent is the same agent in every chat. A soul is capped so it stays sharp and cheap.

/** ASSUMPTION: the longest soul. Long enough for a voice and a list of lessons, short enough to stay sharp. */
export const MAX_SOUL = 3_000

/** The chief: the agent the human texts first. Its soul is the strongest default kiko ships. */
export const KIKO_SOUL = `# kiko

i'm kiko, their chief: the one they text first about anything. i work out what they actually need, get it done, and keep things moving.

## how i am
- sharp, warm, a little dry. a friend who happens to be very good at things.
- i have takes. given options, i pick one and say why in a line.
- i flag a bad idea early and kindly.
- short by default. depth when they ask or when it really matters.

## how i run things
- i answer myself whenever i can. teammates are for real parallel work or a role i don't have.
- when i hand off, i give the goal and the context, not the how, then pull the results together in my own words.
- i keep /chat.md honest so the team works from one picture.

## what i've learned about working with them
`

/** A new agent's first soul: who the human described, and a place for what it learns. */
export function firstSoul(name: string, description: string): string {
  const who = description.trim() || "a sharp, helpful teammate."
  return `# ${name}\n\n${who}\n\n## what i've learned about working with them\n`
}

export type Soul = { body: string; sha: string; at: number }
export type SoulWrite = { ok: true; soul: Soul } | { ok: false; code: "conflict" | "invalid"; message: string }

type Row = { body: string; sha: string; at: number }

async function sha(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

export class Souls {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS souls (slug TEXT PRIMARY KEY, body TEXT NOT NULL, sha TEXT NOT NULL, at INTEGER NOT NULL)")
  }

  private row(slug: string): Row | null {
    return this.sql.exec<Row>("SELECT body, sha, at FROM souls WHERE slug = ?", slug).toArray()[0] ?? null
  }

  /**
   * The agent's soul. An agent that has none yet gets its first one now: kiko's, or one made from
   * the agent the human created (its name and description), or from the handle alone.
   */
  async get(slug: string): Promise<Soul> {
    const found = this.row(slug)
    if (found) return found
    const agent = this.sql.exec<{ name: string; prompt: string }>("SELECT name, prompt FROM agents WHERE slug = ?", slug).toArray()[0]
    return this.seed(slug, slug === "kiko" ? KIKO_SOUL : firstSoul(agent?.name ?? slug, agent?.prompt ?? ""))
  }

  /** Stores a first soul unless the agent has one. Returns what the agent has. */
  async seed(slug: string, body: string): Promise<Soul> {
    const found = this.row(slug)
    if (found) return found
    const soul = { body: body.slice(0, MAX_SOUL), sha: await sha(body.slice(0, MAX_SOUL)), at: Date.now() }
    this.sql.exec("INSERT INTO souls (slug, body, sha, at) VALUES (?, ?, ?, ?)", slug, soul.body, soul.sha, soul.at)
    return soul
  }

  /** Replaces the soul. `expectSha` refuses the write when someone changed it since it was read. */
  async set(slug: string, body: string, expectSha?: string): Promise<SoulWrite> {
    if (!body.trim()) return { ok: false, code: "invalid", message: "a soul cannot be empty" }
    if (body.length > MAX_SOUL) {
      return { ok: false, code: "invalid", message: `that is ${body.length} characters; a soul holds ${MAX_SOUL}. tighten it: merge lessons, drop what no longer matters.` }
    }
    const current = await this.get(slug)
    if (expectSha && current.sha !== expectSha) return { ok: false, code: "conflict", message: "your soul changed since you read it (the human edited it). read it again." }
    const soul = { body, sha: await sha(body), at: Date.now() }
    this.sql.exec("UPDATE souls SET body = ?, sha = ?, at = ? WHERE slug = ?", soul.body, soul.sha, soul.at, slug)
    return { ok: true, soul }
  }
}
