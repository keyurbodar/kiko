import { boolOf, type Judge, type Question } from "@yuki/memory/judge"
import { keywords, type Life } from "@yuki/memory/life"
import { type BurstCheck, type Loop, type Loops, NAP_LOOPS_SYSTEM, napLoopsPrompt, parseNapLoops, sentencesOf } from "@yuki/memory/loops"
import { isAgentSlug } from "@yuki/protocol"
import { classifyBurst } from "./judge"

// Architecture section 26. The part of initiative that lives in UserDO: what a human burst opens or
// closes (Jev), what a summary pass saw (the memory model, in the call it already makes), and the
// lines a run starts with. When to speak up unasked is engine.ts.

export type Heard = { messageId: string; text: string; at: number }

export type InitiativeDeps = {
  loops: Loops
  life: Life
  /** The user's judge, or null with no judge key. */
  judge: () => Judge | null
  /** The judge for a run's first lines: a short timeout, since the run waits on it. */
  quickJudge: () => Judge | null
  /** The chat's title, or null for a private or missing chat. Nothing is learned from those. */
  title: (roomId: string) => string | null
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
/** Without a judge a line must share this many words with the human's message to count as related. */
const SHARED_WORDS = 2
/** A judge reads at most this many open loops beside the keyword matches. */
const JUDGE_POOL = 20

const ref = (roomId: string, messageId: string) => `room:${roomId}:msg:${messageId}`
const escape = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
const day = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

export class Initiative {
  constructor(private readonly deps: InitiativeDeps) {}

  /** One batched Jev call over a burst and the open loops its sentences touch. Without Jev it does nothing. */
  async heard(roomId: string, burst: readonly Heard[]): Promise<"done" | "later"> {
    const judge = this.deps.judge()
    if (!judge || this.deps.title(roomId) === null) return "done"
    const sentences = sentencesOf(burst.map((h) => h.text))
    if (!sentences.length) return "done"
    // Each sentence is checked against the open loops that share its words and every loop its own
    // message already opened (the agent's run may have kept it first, in other words).
    const near: BurstCheck["near"] = []
    sentences.forEach((s, i) => {
      const own = this.deps.loops.fromRef(ref(roomId, burst[s.from]!.messageId))
      const similar = this.deps.loops.similar(s.text, NEAR_PER_SENTENCE, own.map((l) => l.id))
      for (const loop of [...own, ...similar]) near.push({ sentence: i, loop })
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
        { kind: op.kind, certainty: op.certainty, owner: "human", text: sentences[op.sentence]!.text, source: "jev", room: roomId, ref: ref(roomId, from.messageId), at: from.at },
        op.same,
      )
      if (out.ok) this.deps.count(out.merged ? { loops_merged: 1 } : { loops_opened: 1 })
    }
    return "done"
  }

  /** The page prompt with the loop part, or null when the chat is private. */
  napPrompt(roomId: string, prompt: string, endsAt: number): { system: string; prompt: string; known: Set<number> } | null {
    if (this.deps.title(roomId) === null) return null
    const mine = this.deps.loops.list({ room: roomId, status: ["open"], limit: NAP_KNOWN })
    const near = this.deps.loops.similar(prompt, NAP_KNOWN - mine.length, mine.map((l) => l.id))
    const known = [...mine, ...near]
    return { system: NAP_LOOPS_SYSTEM, prompt: napLoopsPrompt(prompt, known, endsAt), known: new Set(known.map((l) => l.id)) }
  }

  /** Writes what the summary pass saw and returns its summary line. */
  napApply(roomId: string, answer: string, known: ReadonlySet<number>, endsAt: number, tainted: boolean): string | null {
    const { summary, ops } = parseNapLoops(answer, known)
    for (const op of ops) {
      if (op.op === "close") {
        this.deps.close(op.id, op.status, endsAt)
        continue
      }
      if (op.owner !== "human" && !isAgentSlug(op.owner)) continue
      const out = this.deps.loops.open({ kind: op.kind, certainty: op.certainty, owner: op.owner, text: op.text, due: op.due, source: "nap", room: roomId, at: endsAt, tainted })
      if (out.ok) this.deps.count(out.merged ? { loops_merged: 1 } : { loops_opened: 1 })
    }
    return summary
  }

  /**
   * The lines a run starts with when the human writes: what this agent owes, and at most three open
   * loops or life lines related to the burst. Without a judge, relation is shared words; with one,
   * the judge reranks keyword matches and the newest open loops, so a related loop needs no shared word.
   */
  async brief(roomId: string, slug: string, burst: { text: string; messageIds: readonly string[] }): Promise<{ owe: string[]; related: string[]; noticed: string[] }> {
    const { owe, related, shown } = await this.ownAndRelated(roomId, slug, burst)
    const skip = new Set([...shown, ...burst.messageIds.flatMap((id) => this.deps.loops.fromRef(ref(roomId, id)).map((l) => l.id))])
    const noticed = this.deps.title(roomId) === null ? [] : this.deps.noticed(roomId, skip).map(escape)
    return { owe, related, noticed }
  }

  private async ownAndRelated(roomId: string, slug: string, burst: { text: string; messageIds: readonly string[] }): Promise<{ owe: string[]; related: string[]; shown: number[] }> {
    const here = this.deps.title(roomId)
    if (here === null) return { owe: [], related: [], shown: [] }
    const where = (l: Loop) => (l.room && l.room !== roomId ? this.deps.title(l.room) : null)
    // Only this chat's: a promise is kept where it was made, and one from another chat invited a duplicate.
    const owed = this.deps.loops.list({ owner: slug, room: roomId, status: ["open"], limit: OWE_MAX })
    const owe = owed.map((l) => escape(`L${l.id} ${l.text}${l.due ? ` (due ${l.due})` : ""}`))
    const words = keywords(burst.text)
    const ids = (picked: readonly string[]) => [...owed.map((l) => l.id), ...picked.filter((id) => id.startsWith("l")).map((id) => Number(id.slice(1)))]
    if (!words.length) return { owe, related: [], shown: ids([]) }
    const fresh = new Set(burst.messageIds.map((id) => ref(roomId, id)))
    const skip = owed.map((l) => l.id)
    const judge = this.deps.judge() !== null
    const loops = new Map<number, Loop>()
    for (const l of this.deps.loops.similar(burst.text, 8, skip)) if (!fresh.has(l.ref)) loops.set(l.id, l)
    if (judge) for (const l of this.deps.loops.list({ status: ["open"], limit: JUDGE_POOL })) if (!fresh.has(l.ref) && !skip.includes(l.id) && loops.size < JUDGE_POOL) loops.set(l.id, l)
    const lines = [
      ...[...loops.values()].map((l) => ({
        id: `l${l.id}`,
        text: `open L${l.id}: ${l.text}${l.due ? ` (due ${l.due})` : ""} (${l.owner === "human" ? "said" : `@${l.owner} promised`} ${day(l.openedAt)}${where(l) ? `, in chat ${where(l)}` : ""})${l.tainted ? " [outside]" : ""}`,
        words: keywords(l.text),
      })),
      ...this.deps.life
        .recall(words.join(" "), 8, { skipCard: true })
        .filter((l) => l.source !== `chat ${here}`)
        .map((l) => ({ id: `m${l.pos}`, text: `memory: ${l.source ? `${l.source}: ` : ""}${l.text}${l.tainted ? " [outside]" : ""}`, words: keywords(l.text) })),
    ]
    if (!lines.length) return { owe, related: [], shown: ids([]) }
    let picked = judge ? await this.related(burst.text, lines) : null
    if (picked === null) {
      const mine = new Set(words)
      picked = lines.filter((l) => l.words.filter((w) => mine.has(w)).length >= SHARED_WORDS).map((l) => l.id)
    }
    const byId = new Map(lines.map((l) => [l.id, l.text]))
    const top = picked.slice(0, RELATED_MAX)
    return { owe, related: top.map((id) => escape(byId.get(id)!)), shown: ids(top) }
  }

  /** Ids of the lines the judge finds related, most related first. Null when no judge answers. */
  private async related(message: string, lines: readonly { id: string; text: string }[]): Promise<string[] | null> {
    const judge = this.deps.quickJudge()
    if (!judge) return null
    const questions: Record<string, Question> = {}
    lines.forEach((_, i) => {
      questions[`r${i}`] = { type: "bool", instructions: `Is \`lines[${i}]\` related to what the human says in \`message\`?`, criteria: RELATED }
    })
    const answers = await judge({ message, lines: lines.map((l) => l.text) }, questions)
    if (!answers) return null
    this.deps.count({ related_jev: 1 })
    return lines
      .map((l, i) => ({ id: l.id, p: boolOf(answers[`r${i}`]) }))
      .filter((x) => x.p > 0.5)
      .sort((a, b) => b.p - a.p)
      .map((x) => x.id)
  }
}

const RELATED = {
  true: "an agent answering the message would do better knowing this line: it is the same matter, or it bears on it",
  false: "it is about something else",
}
