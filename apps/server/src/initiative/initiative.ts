import type { Judge } from "@yuki/memory/judge"
import { keywords, type Life } from "@yuki/memory/life"
import { type BurstCheck, type Loop, type Loops, NAP_LOOPS_SYSTEM, napLoopsPrompt, parseNapLoops, sentencesOf } from "@yuki/memory/loops"
import { isAgentSlug } from "@yuki/protocol"
import { day, SHARED_WORDS } from "./engine"
import { classifyBurst } from "./judge"

// Architecture section 26. The part of initiative that lives in UserDO: what a human burst and the
// agent's answer open or close (Jev), what a summary pass saw (the memory model, in the call it
// already makes), and the lines a run starts with. When to speak up unasked is engine.ts.

/** `by` is the agent's slug for its answer; a human message has none. */
export type Heard = { messageId: string; text: string; at: number; by?: string }

type InitiativeDeps = {
  loops: Loops
  life: Life
  /** The user's judge, or null with no judge key. */
  judge: () => Judge | null
  /** The chat's title, or null for a private or missing chat. Nothing is learned from those. */
  title: (roomId: string) => string | null
  /** Initiative is off: no Jev pass, no summary loop lines, and no lines in a run. */
  off: () => boolean
  count: (delta: Record<string, number>) => void
  /** Closes a loop the one way every closer does, so a drop settles a nudge about it. */
  close: (id: number, status: "done" | "dropped", at: number) => boolean
  /** The attention engine's brief channel: open loops of this chat worth keeping in view, best first. */
  noticed: (roomId: string, skip: ReadonlySet<number>) => string[]
}

const NEAR_PER_SENTENCE = 3
const OWE_MAX = 3
const RELATED_MAX = 3
const NAP_KNOWN = 12

const ref = (roomId: string, messageId: string) => `room:${roomId}:msg:${messageId}`
const escape = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export class Initiative {
  constructor(private readonly deps: InitiativeDeps) {}

  /** One batched Jev call over a burst, the agent's answers to it, and the open loops their sentences touch. Without Jev it does nothing. */
  async heard(roomId: string, burst: readonly Heard[]): Promise<"done" | "later"> {
    const judge = this.deps.judge()
    if (!judge || this.deps.off() || this.deps.title(roomId) === null) return "done"
    const sentences = sentencesOf(burst)
    if (!sentences.length) return "done"
    // A human sentence is checked against the open loops that share its words; an agent's against its
    // own open promises here, so one it already keeps (a reminder it set for itself) is not opened twice.
    const near: BurstCheck["near"] = []
    sentences.forEach((s, i) => {
      const loops = s.by ? this.deps.loops.list({ owner: s.by, room: roomId, status: ["open"], limit: NEAR_PER_SENTENCE }) : this.deps.loops.similar(s.text, NEAR_PER_SENTENCE)
      for (const loop of loops) near.push({ sentence: i, loop })
    })
    const check = { sentences, near }
    const ops = await classifyBurst(judge, check)
    if (!ops) return "later"
    this.deps.count({ loops_jev: 1 })
    for (const op of ops) {
      const from = burst[sentences[op.sentence]!.from]!
      if (op.op === "close") {
        this.deps.close(op.id, op.status, from.at)
        continue
      }
      const out = this.deps.loops.open(
        { kind: op.kind, certainty: op.certainty, owner: op.owner, text: sentences[op.sentence]!.text, source: "jev", room: roomId, ref: ref(roomId, from.messageId), at: from.at, tainted: false },
        op.same,
      )
      if (out.ok) this.deps.count(out.merged ? { loops_merged: 1 } : { loops_opened: 1 })
    }
    return "done"
  }

  /** The page prompt with the loop part, or null when the chat is private or initiative is off. */
  napPrompt(roomId: string, prompt: string, endsAt: number): { system: string; prompt: string; known: Set<number> } | null {
    if (this.deps.off() || this.deps.title(roomId) === null) return null
    const mine = this.deps.loops.list({ room: roomId, status: ["open"], limit: NAP_KNOWN })
    const near = this.deps.loops.similar(prompt, NAP_KNOWN - mine.length, mine.map((l) => l.id))
    const known = [...mine, ...near]
    return { system: NAP_LOOPS_SYSTEM, prompt: napLoopsPrompt(prompt, known, endsAt), known: new Set(known.map((l) => l.id)) }
  }

  /** Writes what the summary pass saw and returns its summary line. `turns` names the page, so forgetting a turn forgets its loops. */
  napApply(roomId: string, answer: string, known: ReadonlySet<number>, endsAt: number, tainted: boolean, turns?: { lo: number; hi: number }): string | null {
    const { summary, ops } = parseNapLoops(answer, known)
    for (const op of ops) {
      if (op.op === "close") {
        this.deps.close(op.id, op.status, endsAt)
        continue
      }
      if (op.owner !== "human" && !isAgentSlug(op.owner)) continue
      const out = this.deps.loops.open({ kind: op.kind, certainty: op.certainty, owner: op.owner, text: op.text, due: op.due, source: "nap", room: roomId, ...(turns ? { ref: `room:${roomId}:turns:${turns.lo}-${turns.hi}` } : {}), at: endsAt, tainted })
      if (out.ok) this.deps.count(out.merged ? { loops_merged: 1 } : { loops_opened: 1 })
    }
    return summary
  }

  /**
   * The lines a run starts with when the human writes: what this agent owes, and at most three open
   * loops or life lines that share two words with the burst. SQL only, no model call: the run waits
   * on it. These lines sit in the human's input, which the trust extension never taints, so nothing
   * tainted goes in: a tainted loop or life line stays reachable only through memory recall.
   */
  brief(roomId: string, slug: string, burst: { text: string }): { owe: string[]; related: string[]; noticed: string[] } {
    if (this.deps.off()) return { owe: [], related: [], noticed: [] }
    const { owe, related, shown } = this.ownAndRelated(roomId, slug, burst)
    const noticed = this.deps.title(roomId) === null ? [] : this.deps.noticed(roomId, new Set(shown)).map(escape)
    return { owe, related, noticed }
  }

  private ownAndRelated(roomId: string, slug: string, burst: { text: string }): { owe: string[]; related: string[]; shown: number[] } {
    const here = this.deps.title(roomId)
    if (here === null) return { owe: [], related: [], shown: [] }
    const where = (l: Loop) => (l.room && l.room !== roomId ? this.deps.title(l.room) : null)
    // A loop of a private or deleted chat stays there.
    const shown = (l: Loop) => !l.tainted && (!l.room || l.room === roomId || this.deps.title(l.room) !== null)
    // Only this chat's: a promise is kept where it was made, and one from another chat invited a duplicate.
    const owed = this.deps.loops.list({ owner: slug, room: roomId, status: ["open"], limit: 20 }).filter(shown).slice(0, OWE_MAX)
    const owe = owed.map((l) => escape(`L${l.id} ${l.text}${l.due ? ` (due ${l.due})` : ""}`))
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
        .filter((l) => l.source !== `chat ${here}` && !l.tainted)
        .map((l) => ({ id: `m${l.pos}`, text: `memory: ${l.source ? `${l.source}: ` : ""}${l.text}`, words: keywords(l.text) })),
    ]
    const mine = new Set(words)
    const picked = lines.filter((l) => l.words.filter((w) => mine.has(w)).length >= SHARED_WORDS).map((l) => l.id)
    const byId = new Map(lines.map((l) => [l.id, l.text]))
    const top = picked.slice(0, RELATED_MAX)
    return { owe, related: top.map((id) => escape(byId.get(id)!)), shown: ids(top) }
  }
}
