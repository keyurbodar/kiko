import type { Judge } from "@kiko/memory/judge"
import { keywords, type Life } from "@kiko/memory/life"
import { type BurstCheck, type Loop, type Loops, NAP_LOOPS_SYSTEM, napLoopsPrompt, parseNapLoops, sentencesOf } from "@kiko/memory/loops"
import { escapeXml } from "@kiko/agent/text"
import { isAgentSlug } from "@kiko/protocol"
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
  noticed: (roomId: string, skip: ReadonlySet<number>) => string[]
  nudges: (roomId: string) => { loop: string; what: string }[]
  answered: (roomId: string, loop: string, messageId: string, at: number) => void
}

const NEAR_PER_SENTENCE = 3
const OWE_MAX = 3
const RELATED_MAX = 3
const NAP_KNOWN = 12

const ref = (roomId: string, messageId: string) => `room:${roomId}:msg:${messageId}`

export class Initiative {
  constructor(private readonly deps: InitiativeDeps) {}

  async heard(roomId: string, burst: readonly Heard[]): Promise<"done" | "later"> {
    const judge = this.deps.judge()
    if (!judge || this.deps.off() || this.deps.title(roomId) === null) return "done"
    const sentences = sentencesOf(burst)
    const said = burst.filter((m) => !m.by)
    const nudges = said.length ? this.deps.nudges(roomId) : []
    if (!sentences.length && !nudges.length) return "done"
    const near: BurstCheck["near"] = []
    sentences.forEach((s, i) => {
      const loops = s.by ? this.deps.loops.list({ owner: s.by, room: roomId, status: ["open"], limit: NEAR_PER_SENTENCE }) : this.deps.loops.similar(s.text, NEAR_PER_SENTENCE)
      for (const loop of loops) near.push({ sentence: i, loop })
    })
    const check = { sentences, near }
    const out = await classifyBurst(judge, check, { nudges: nudges.map((n) => n.what), said: said.map((m) => m.text) })
    if (!out) return "later"
    this.deps.count({ loops_jev: 1 })
    const last = said.at(-1)
    for (const i of out.answered) {
      const nudge = nudges[i]
      if (nudge && last) this.deps.answered(roomId, nudge.loop, last.messageId, last.at)
    }
    for (const op of out.ops) {
      const sentence = sentences[op.sentence]
      const from = sentence && burst[sentence.from]
      if (!sentence || !from) throw new Error(`initiative burst has no message for sentence ${op.sentence}`)
      if (op.op === "close") {
        // A human's own plan may be done from any chat. An agent's promise closes only from the chat it was made in.
        this.deps.close(op.id, op.status, from.at, this.deps.loops.get(op.id)?.owner === "human" ? undefined : roomId)
        continue
      }
      const out = this.deps.loops.open(
        { kind: op.kind, certainty: op.certainty, owner: op.owner, text: sentence.text, source: "jev", room: roomId, ref: ref(roomId, from.messageId), at: from.at },
        op.same,
      )
      if (out.ok) this.deps.count(out.merged ? { loops_merged: 1 } : { loops_opened: 1 })
    }
    return "done"
  }

  napPrompt(roomId: string, prompt: string, endsAt: number): { system: string; prompt: string; known: Set<number> } | null {
    if (this.deps.off() || this.deps.title(roomId) === null) return null
    const mine = this.deps.loops.list({ room: roomId, status: ["open"], limit: NAP_KNOWN })
    const near = this.deps.loops.similar(prompt, NAP_KNOWN - mine.length, mine.map((l) => l.id))
    const known = [...mine, ...near]
    return { system: NAP_LOOPS_SYSTEM, prompt: napLoopsPrompt(prompt, known, endsAt), known: new Set(known.map((l) => l.id)) }
  }

  napApply(roomId: string, answer: string, known: ReadonlySet<number>, endsAt: number, turns?: { lo: number; hi: number }): string | null {
    const { summary, ops } = parseNapLoops(answer, known)
    for (const op of ops) {
      if (op.op === "close") {
        this.deps.close(op.id, op.status, endsAt)
        continue
      }
      if (op.owner !== "human" && !isAgentSlug(op.owner)) continue
      const out = this.deps.loops.open({ kind: op.kind, certainty: op.certainty, owner: op.owner, text: op.text, due: op.due, source: "nap", room: roomId, ...(turns ? { ref: `room:${roomId}:turns:${turns.lo}-${turns.hi}` } : {}), at: endsAt })
      if (out.ok) this.deps.count(out.merged ? { loops_merged: 1 } : { loops_opened: 1 })
    }
    return summary
  }

  brief(roomId: string, slug: string, burst: { text: string }): { owe: string[]; related: string[]; noticed: string[] } {
    if (this.deps.off()) return { owe: [], related: [], noticed: [] }
    const { owe, related, shown } = this.ownAndRelated(roomId, slug, burst)
    const noticed = this.deps.title(roomId) === null ? [] : this.deps.noticed(roomId, new Set(shown)).map(escapeXml)
    return { owe, related, noticed }
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
