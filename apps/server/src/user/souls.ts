import { sha256Hex } from "@yuki/durable/hash"

export const MAX_SOUL = 3_000

export const YUKI_SOUL = `# yuki

i'm yuki, their chief: the one they text first about anything. i work out what they actually need, get it done, and keep things moving.

## how i am
- direct and exact.
- i have takes. given options, i pick one and say why in a line.
- i flag a bad idea early and kindly.
- short by default. depth when they ask or when it really matters.

## how i run things
- i answer myself whenever i can. teammates are for real parallel work or a role i don't have.
- when i hand off, i give the goal and the context, not the how, then pull the results together in my own words.
- i keep /chat.md honest so the team works from one picture.

## what i've learned about working with them
`

export function firstSoul(name: string, description: string): string {
  const who = description.trim() || "a direct, helpful teammate."
  return `# ${name}\n\n${who}\n\n## what i've learned about working with them\n`
}

export type Soul = { body: string; sha: string; at: number }
export type SoulWrite = { ok: true; soul: Soul } | { ok: false; code: "conflict" | "invalid"; message: string }

type Row = { body: string; sha: string; at: number }

export class Souls {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS souls (slug TEXT PRIMARY KEY, body TEXT NOT NULL, sha TEXT NOT NULL, at INTEGER NOT NULL)")
  }

  private row(slug: string): Row | null {
    return this.sql.exec<Row>("SELECT body, sha, at FROM souls WHERE slug = ?", slug).toArray()[0] ?? null
  }

  async get(slug: string): Promise<Soul> {
    const found = this.row(slug)
    if (found) return found
    const agent = this.sql.exec<{ name: string; prompt: string }>("SELECT name, prompt FROM agents WHERE slug = ?", slug).toArray()[0]
    return this.seed(slug, slug === "yuki" ? YUKI_SOUL : firstSoul(agent?.name ?? slug, agent?.prompt ?? ""))
  }

  async seed(slug: string, body: string): Promise<Soul> {
    const found = this.row(slug)
    if (found) return found
    const soul = { body: body.slice(0, MAX_SOUL), sha: await sha256Hex(body.slice(0, MAX_SOUL)), at: Date.now() }
    this.sql.exec("INSERT INTO souls (slug, body, sha, at) VALUES (?, ?, ?, ?)", slug, soul.body, soul.sha, soul.at)
    return soul
  }

  async set(slug: string, body: string, expectSha: string): Promise<SoulWrite> {
    if (!body.trim()) return { ok: false, code: "invalid", message: "a soul cannot be empty" }
    if (body.length > MAX_SOUL) {
      return { ok: false, code: "invalid", message: `that is ${body.length} characters; a soul holds ${MAX_SOUL}. tighten it: merge lessons, drop what no longer matters.` }
    }
    const current = await this.get(slug)
    if (current.sha !== expectSha) return { ok: false, code: "conflict", message: "your soul changed since you read it (the human edited it). read it again." }
    const soul = { body, sha: await sha256Hex(body), at: Date.now() }
    this.sql.exec("UPDATE souls SET body = ?, sha = ?, at = ? WHERE slug = ?", soul.body, soul.sha, soul.at, slug)
    return { ok: true, soul }
  }
}
