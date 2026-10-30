import { mentionsHuman, type Message, type MessageId } from "@kiko/protocol"
import { windowKey, type StepWindow } from "../chat/run/run-log"
export const PENDING_SEQ = Number.MAX_SAFE_INTEGER

export type LedgerSent = {
  readonly seq: number
  readonly from: { readonly kind: string; readonly slug?: string }
}

export type LedgerSaid = {
  readonly id: MessageId
  readonly seq: number
  readonly at: number
  readonly agent: boolean
}

export type LedgerMention = { readonly id: MessageId; readonly seq: number }

export type LedgerPendingWindow = { readonly key: string; readonly count: number }

const NO_PENDING: readonly LedgerPendingWindow[] = []

export type MessageListDiff =
  | { readonly kind: "same" }
  | { readonly kind: "replace"; readonly changed: readonly number[] }
  | { readonly kind: "rebuild" }

const SAME: MessageListDiff = { kind: "same" }
const REBUILD: MessageListDiff = { kind: "rebuild" }
const NO_WINDOWS: ReadonlyMap<string, StepWindow> = new Map()

export function diffMessages(previous: readonly Message[], next: readonly Message[]): MessageListDiff {
  if (previous === next) return SAME
  if (previous.length !== next.length) return REBUILD
  const changed: number[] = []
  for (let i = 0; i < next.length; i += 1) if (previous[i] !== next[i]) changed.push(i)
  return changed.length === 0 ? SAME : { kind: "replace", changed }
}

const diffs = new WeakMap<
  readonly Message[],
  { readonly previous: readonly Message[]; readonly diff: MessageListDiff }
>()

function sharedDiff(previous: readonly Message[], next: readonly Message[]): MessageListDiff {
  const held = diffs.get(next)
  if (held && held.previous === previous) return held.diff
  const diff = diffMessages(previous, next)
  diffs.set(next, { previous, diff })
  return diff
}

type Fact = {
  readonly message: Message
  readonly id: MessageId
  readonly seq: number
  readonly at: number
  readonly pending: boolean
  readonly event: boolean
  readonly agent: boolean
  readonly human: boolean
  readonly slug: string | undefined
  readonly to: string | undefined
  readonly replyTo: MessageId | undefined
  readonly listed: boolean
  readonly botId: string | undefined
  readonly steps: number | undefined
  readonly stepAfter: number
  readonly text: string
  readonly goto: boolean
  mentioned: boolean
  mentionOwn: string | null | undefined
}

function factOf(message: Message): Fact {
  const pending = message.seq === PENDING_SEQ
  const event = message.event !== undefined
  const agent = message.from.kind === "agent"
  const activity = message.event?.kind === "activity" && "agent" in message.event ? message.event.agent : undefined
  return {
    message,
    id: message.id,
    seq: message.seq,
    at: message.at,
    pending,
    event,
    agent,
    human: message.from.kind === "human",
    slug: agent ? message.from.slug : undefined,
    to: message.to,
    replyTo: message.replyTo,
    listed: message.to === undefined && !(message.event && "private" in message.event),
    botId: agent ? message.from.slug : activity,
    steps: message.steps,
    stepAfter: message.stepAfter ?? 0,
    text: message.text,
    goto: message.goto !== undefined,
    mentioned: false,
    mentionOwn: undefined,
  }
}

function sameIdentity(a: Fact, b: Fact): boolean {
  return (
    a.id === b.id &&
    a.seq === b.seq &&
    a.at === b.at &&
    a.pending === b.pending &&
    a.event === b.event &&
    a.agent === b.agent &&
    a.human === b.human &&
    a.slug === b.slug &&
    a.to === b.to &&
    a.replyTo === b.replyTo &&
    a.listed === b.listed &&
    a.botId === b.botId &&
    a.steps === b.steps &&
    a.stepAfter === b.stepAfter &&
    a.goto === b.goto
  )
}

type MentionEntry = { readonly id: MessageId; readonly seq: number; readonly pos: number }

function pendingWindowsOf(facts: readonly Fact[]): Map<string, readonly LedgerPendingWindow[]> {
  const waiting = new Map<string, Fact[]>()
  for (const fact of facts) {
    const activity = fact.event && fact.botId && fact.steps ? fact.botId : undefined
    const key = activity ?? (fact.human ? "user" : (fact.botId ?? ""))
    const held = waiting.get(key)
    const folds =
      !activity && held !== undefined && !fact.human && fact.steps && fact.to === undefined && !fact.event && !fact.goto
    if (folds) waiting.delete(key)
    for (const other of waiting.keys()) if (other !== key) waiting.delete(other)
    if (!activity) continue
    if (held) held.push(fact)
    else waiting.set(key, [fact])
  }
  const out = new Map<string, readonly LedgerPendingWindow[]>()
  for (const [slug, list] of waiting) {
    const windows: LedgerPendingWindow[] = []
    for (const fact of list) if (fact.steps) windows.push({ key: windowKey(slug, fact.stepAfter), count: fact.steps })
    out.set(slug, windows)
  }
  return out
}

export class MessageLedger {
  private source: readonly Message[] = []
  private facts: Fact[] = []
  private factCache = new WeakMap<Message, Fact>()
  private sentList: readonly LedgerSent[] = []
  private saidList: readonly LedgerSaid[] = []
  private windowMap: ReadonlyMap<string, StepWindow> = NO_WINDOWS
  private agentFacts = new Map<string, Fact[]>()
  private humanIds = new Set<MessageId>()
  private newestHuman = 0
  private newest: Message | undefined
  private sorted = true
  private pending = new Map<string, readonly LedgerPendingWindow[]>()
  private own: string | null | undefined = undefined
  private mentionEntries: readonly MentionEntry[] = []
  private mentionView: readonly LedgerMention[] | undefined = []
  private change: MessageListDiff = SAME

  get lastChange(): MessageListDiff {
    return this.change
  }

  update(next: readonly Message[]): void {
    if (next === this.source) {
      this.change = SAME
      return
    }
    const diff = sharedDiff(this.source, next)
    this.change = diff
    if (diff.kind === "same") {
      this.source = next
      return
    }
    if (diff.kind === "rebuild") {
      this.rebuild(next)
      return
    }
    const fresh: Fact[] = []
    for (const index of diff.changed) {
      const old = this.facts[index]!
      const fact = this.fact(next[index]!)
      if (!sameIdentity(old, fact)) {
        this.rebuild(next)
        return
      }
      fresh.push(fact)
    }
    this.replace(next, diff.changed, fresh)
    return
  }

  private fact(message: Message): Fact {
    const cached = this.factCache.get(message)
    if (cached) return cached
    const fresh = factOf(message)
    this.factCache.set(message, fresh)
    return fresh
  }

  private replace(next: readonly Message[], changed: readonly number[], fresh: readonly Fact[]): void {
    changed.forEach((index, at) => {
      const old = this.facts[index]!
      const fact = fresh[at]!
      this.facts[index] = fact
      if (this.own === undefined || fact.text === old.text) return
      const hit = this.mentionsNow(fact)
      fact.mentionOwn = this.own
      fact.mentioned = hit
      if (hit !== old.mentioned) this.flipMention(fact, index, hit)
    })
    this.source = next
  }

  private mentionsNow(fact: Fact): boolean {
    const own = this.own ?? null
    const repliesToHuman = fact.replyTo !== undefined && this.humanIds.has(fact.replyTo)
    return !fact.pending && fact.agent && fact.to === undefined && mentionsHuman(fact.text, own, repliesToHuman)
  }

  private flipMention(fact: Fact, pos: number, hit: boolean): void {
    if (!hit) {
      this.mentionEntries = this.mentionEntries.filter((entry) => entry.id !== fact.id)
      this.mentionView = undefined
      return
    }
    const entry = { id: fact.id, seq: fact.seq, pos }
    const at = this.mentionEntries.findIndex((held) => held.pos > pos)
    this.mentionEntries =
      at === -1
        ? [...this.mentionEntries, entry]
        : [...this.mentionEntries.slice(0, at), entry, ...this.mentionEntries.slice(at)]
    this.mentionView = undefined
  }

  private rebuild(next: readonly Message[]): void {
    const facts = next.map((message) => this.fact(message))
    const sent: LedgerSent[] = []
    const said: LedgerSaid[] = []
    const windows = new Map<string, StepWindow>()
    const agents = new Map<string, Fact[]>()
    const humans = new Set<MessageId>()
    let newestHuman = 0
    let newest: Message | undefined
    let sorted = true
    let lastSeq = Number.NEGATIVE_INFINITY
    for (const fact of facts) {
      if (fact.seq < lastSeq) sorted = false
      lastSeq = fact.seq
      if (fact.human) humans.add(fact.id)
      if (!fact.pending && !fact.event) {
        sent.push({ seq: fact.seq, from: fact.message.from })
        if (fact.human) newestHuman = Math.max(newestHuman, fact.seq)
      }
      if (!fact.pending) {
        said.push({ id: fact.id, seq: fact.seq, at: fact.at, agent: !fact.event && !fact.human })
      }
      if (fact.listed) newest = fact.message
      if (!fact.pending && fact.agent && !fact.event) {
        const list = agents.get(fact.slug!)
        if (list) list.push(fact)
        else agents.set(fact.slug!, [fact])
      }
      if (fact.botId && fact.steps) {
        const key = windowKey(fact.botId, fact.stepAfter)
        windows.set(key, { key, slug: fact.botId, after: fact.stepAfter, steps: fact.steps })
      }
    }
    this.source = next
    this.facts = facts
    this.sentList = sent
    this.saidList = said
    this.windowMap = windows
    this.agentFacts = agents
    this.humanIds = humans
    this.newestHuman = newestHuman
    this.newest = newest
    this.sorted = sorted
    this.pending = pendingWindowsOf(facts)
    if (this.own !== undefined) this.rebuildMentions()
    else this.mentionEntries = []
    this.mentionView = undefined
  }

  private rebuildMentions(): void {
    const entries: MentionEntry[] = []
    this.facts.forEach((fact, pos) => {
      const hit = this.mentionsNow(fact)
      fact.mentionOwn = this.own
      fact.mentioned = hit
      if (hit) entries.push({ id: fact.id, seq: fact.seq, pos })
    })
    this.mentionEntries = entries
    this.mentionView = undefined
  }

  sent(): readonly LedgerSent[] {
    return this.sentList
  }

  said(): readonly LedgerSaid[] {
    return this.saidList
  }

  windows(): ReadonlyMap<string, StepWindow> {
    return this.windowMap
  }

  pendingWindows(slug: string): readonly LedgerPendingWindow[] {
    return this.pending.get(slug) ?? NO_PENDING
  }

  newestHumanSeq(): number {
    if (this.sorted) return this.newestHuman
    let found = 0
    for (let i = this.sentList.length - 1; i >= 0; i -= 1) {
      const sent = this.sentList[i]!
      if (sent.from.kind === "human") {
        found = sent.seq
        break
      }
    }
    return found
  }

  newestSeq(): number {
    return this.saidList.at(-1)?.seq ?? 0
  }

  newestListed(): Message | undefined {
    return this.newest
  }

  repliedSince(slug: string, mark: number): boolean {
    const list = this.agentFacts.get(slug)
    if (!list || list.length === 0) return false
    if (this.sorted) return list[list.length - 1]!.seq > mark
    return list.some((fact) => fact.seq > mark)
  }

  firstReplyAfter(slug: string, after: number): { id: MessageId; seq: number } | undefined {
    const list = this.agentFacts.get(slug)
    if (!list || list.length === 0) return undefined
    if (!this.sorted) {
      const found = list.find((fact) => fact.seq > after)
      return found === undefined ? undefined : { id: found.id, seq: found.seq }
    }
    let low = 0
    let high = list.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (list[mid]!.seq > after) high = mid
      else low = mid + 1
    }
    const found = list[low]
    return found === undefined ? undefined : { id: found.id, seq: found.seq }
  }

  mentions(handle: string | null, slugs: readonly string[]): readonly LedgerMention[] {
    const own = handle && !slugs.includes(handle) ? handle : null
    if (this.own !== own) {
      this.own = own
      this.rebuildMentions()
    }
    if (this.mentionView === undefined)
      this.mentionView = this.mentionEntries.map((entry) => ({ id: entry.id, seq: entry.seq }))
    return this.mentionView
  }
}
