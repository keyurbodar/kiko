import type { Judge } from "@kiko/memory/judge"
import { keywords, type Life } from "@kiko/memory/life"
import { type BurstCheck, dueAfter, type Loop, type Loops, sentencesOf } from "@kiko/memory/loops"
import { escapeXml } from "@kiko/agent/text"
import { day, SHARED_WORDS } from "./engine"
import { classifyBurst } from "./judge"


export type Heard = { messageId: string; text: string; at: number; by?: string }

type InitiativeDeps = {
  loops: Loops
  life: Life
  judge: () => Judge | null
  title: (roomId: string) => string | null
  off: () => boolean
  count: (delta: Record<string, number>) => void
  close: (id: number, status: "done" | "dropped", at: number, room?: string) => boolean
  noticed: (roomId: string, skip: ReadonlySet<number>) => { id: number; line: string }[]
}

const NEAR_PER_SENTENCE = 3
const OWE_MAX = 3
const RELATED_MAX = 3

const ref = (roomId: string, messageId: string) => `room:${roomId}:msg:${messageId}`

export class Initiative {
  constructor(private readonly deps: InitiativeDeps) {}

  async heard(roomId: string, burst: readonly Heard[]): Promise<"done" | "later"> {
    const judge = this.deps.judge()
    if (!judge || this.deps.off() || this.deps.title(roomId) === null) return "done"
    const sentences = sentencesOf(burst)
    if (!sentences.length) return "done"
    const near: BurstCheck["near"] = []
    sentences.forEach((s, i) => {
      const loops = s.by ? this.deps.loops.list({ owner: s.by, room: roomId, status: ["open"], limit: NEAR_PER_SENTENCE }) : this.deps.loops.similar(s.text, NEAR_PER_SENTENCE)
      for (const loop of loops) near.push({ sentence: i, loop })
    })
    const ops = await classifyBurst(judge, { sentences, near })
    if (!ops) return "later"
    this.deps.count({ loops_jev: 1 })
    for (const op of ops) {
      const sentence = sentences[op.sentence]
      const from = sentence && burst[sentence.from]
      if (!sentence || !from) throw new Error(`initiative burst has no message for sentence ${op.sentence}`)
      if (op.op === "close") {
        // A human's own plan may be done from any chat. An agent's promise closes only from the chat it was made in.
        this.deps.close(op.id, op.status, from.at, this.deps.loops.get(op.id)?.owner === "human" ? undefined : roomId)
        continue
      }
      const out = this.deps.loops.open(
        { kind: op.kind, owner: op.owner, text: sentence.text, ...(op.when ? { due: dueAfter(op.when, from.at) } : {}), source: "jev", room: roomId, ref: ref(roomId, from.messageId), at: from.at },
        op.same,
      )
      if (out.ok) this.deps.count(out.merged ? { loops_merged: 1 } : { loops_opened: 1 })
    }
    return "done"
  }

  brief(roomId: string, slug: string, burst: { text: string }): { owe: string[]; related: string[]; noticed: string[]; noticedIds: number[] } {
    if (this.deps.off()) return { owe: [], related: [], noticed: [], noticedIds: [] }
    const { owe, related, shown } = this.ownAndRelated(roomId, slug, burst)
    const noticed = this.deps.title(roomId) === null ? [] : this.deps.noticed(roomId, new Set(shown))
    return { owe, related, noticed: noticed.map((n) => escapeXml(n.line)), noticedIds: noticed.map((n) => n.id) }
  }

  private ownAndRelated(roomId: string, slug: string, burst: { text: string }): { owe: string[]; related: string[]; shown: number[] } {
    const here = this.deps.title(roomId)
    if (here === null) return { owe: [], related: [], shown: [] }
    const where = (l: Loop) => (l.room && l.room !== roomId ? this.deps.title(l.room) : null)
    const shown = (l: Loop) => (!l.room || l.room === roomId || this.deps.title(l.room) !== null)
    const owed = this.deps.loops.list({ owner: slug, room: roomId, status: ["open"], limit: 20 }).filter(shown).slice(0, OWE_MAX)
    const owe = owed.map((l) => escapeXml(`L${l.id} ${l.text}${l.due ? ` (due ${l.due})` : ""}`))
    const words = keywords(burst.text)
    const ids = (picked: readonly string[]) => [...owed.map((l) => l.id), ...picked.filter((id) => id.startsWith("l")).map((id) => Number(id.slice(1)))]
    if (!words.length) return { owe, related: [], shown: ids([]) }
    const lines = [
      ...this.deps.loops.similar(burst.text, 8, owed.map((l) => l.id)).filter(shown).map((l) => ({
        id: `l${l.id}`,
        text: `open L${l.id}: ${l.text}${l.due ? ` (due ${l.due})` : ""} (${l.owner === "human" ? "said" : `@${l.owner} promised`} ${day(l.openedAt, "UTC")}${where(l) ? `, in chat ${where(l)}` : ""})`,
        words: keywords(l.text),
      })),
      ...this.deps.life
        .recall(words.join(" "), 8, { skipCard: true })
        .filter((l) => l.source !== `chat ${here}`)
        .map((l) => ({ id: `m${l.pos}`, text: `memory: ${l.source ? `${l.source}: ` : ""}${l.text}`, words: keywords(l.text) })),
    ]
    const mine = new Set(words)
    const picked = lines.filter((l) => l.words.filter((w) => mine.has(w)).length >= SHARED_WORDS).map((l) => l.id)
    const byId = new Map(lines.map((l) => [l.id, l.text]))
    const top = picked.slice(0, RELATED_MAX)
    return { owe, related: top.flatMap((id) => { const text = byId.get(id); return text === undefined ? [] : [escapeXml(text)] }), shown: ids(top) }
  }
}
