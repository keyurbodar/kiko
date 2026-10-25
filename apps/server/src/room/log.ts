import { createHash } from "node:crypto"

import type {
  Actor,
  AgentSlug,
  FileRef,
  Message,
  MessageId,
  Reaction,
  ReplyPreview,
  RichText,
  RoomEvent,
  RoomSnapshot,
  RunRef,
  RunStep,
  Sender,
  SystemEvent,
  RoomId,
} from "@kiko/protocol"
import { listSpace, ROOM_TABLES } from "../files/file-index"
import { messageIdAt, messageSeq, messageSeqs } from "./message-position"
import { listMembers } from "./members"
import { replyAddressees, resolveRecipients, tags } from "./recipients"
import type { Pending } from "./burst"
import { listAsks } from "./human-asks"
import { type HeardStep, RunSteps } from "./steps"
import { listTasks } from "./workspace"
import { actorFromKey, actorKey } from "./actor-key"

import type { ArchivedMessage } from "../owner/history-archive"

const REPLAY_LIMIT = 500
const KEEP_EVENTS = 2 * REPLAY_LIMIT
const TRIM_EVERY = 100
const SNAPSHOT_MESSAGES = 200

const PUBLIC_MESSAGE = "(event IS NULL OR json_extract(event, '$.private') IS NOT 1)"

export const LISTED_MESSAGE = `${PUBLIC_MESSAGE} AND addressed IS NULL`

const PREVIEW_CHARS = 140

function previewText(text: string, files: readonly Pick<FileRef, "name" | "type">[] = []): string {
  const body = text.replace(/\s+/g, " ").trim()
  if (body)
    return body.length > PREVIEW_CHARS
      ? `${Array.from(body)
          .slice(0, PREVIEW_CHARS - 1)
          .join("")}…`
      : body
  const images = files.filter((f) => f.type.startsWith("image/")).length
  const others = files.filter((f) => !f.type.startsWith("image/"))
  if (!files.length) return ""
  if (!others.length) return images > 1 ? `${images} photos` : "Photo"
  const rest = files.length - 1
  return rest > 0 ? `${others[0]!.name} and ${rest} more` : others[0]!.name
}

export const isPrivate = (m: { event?: { kind: string } }): boolean =>
  (m.event as { private?: boolean } | undefined)?.private === true

type Body = RoomEvent extends infer E ? (E extends unknown ? Omit<E, "seq" | "at"> : never) : never

type MessageRow = {
  id: string
  seq: number
  at: number
  sender: string
  text: string
  rich: string | null
  reply_to: string | null
  files: string | null
  run_id: string | null
  run_attempt: number | null
  run_index: number | null
  edited_at: number | null
  deleted_at: number | null
  goto: string | null
  quote: string | null
  addressed: string | null
  initiative: string | null
  steps: number | null
  step_after: number | null
  event: string | null
  client_id: string | null
  message_payload: string | null
  mentions: string | null
}

export type NewMessage = {
  from: Sender
  text: string
  rich?: RichText
  replyTo?: MessageId
  files?: readonly FileRef[]
  run?: RunRef
  clientId?: string
  mentions?: readonly string[]
  goto?: RoomId
  quote?: string
  to?: AgentSlug | "all"
  initiative?: { reason: string }
  event?: SystemEvent
}

export class RoomLog {
  readonly steps: RunSteps
  private readonly windows = new Map<string, { after: number; count: number }>()

  constructor(
    private readonly storage: DurableObjectStorage,
    readonly roomId: string,
    private readonly now: () => number = Date.now,
    private readonly scopedStorage: DurableObjectStorage = storage,
  ) {
    this.steps = new RunSteps(storage, roomId, now)
  }

  private insertMessage(
    input: NewMessage,
    id: MessageId,
    event: Extract<RoomEvent, { t: "message" }>,
    steps: number,
    open: { after: number; count: number } | null,
  ): void {
    this.sql.exec(
      `INSERT INTO messages (room_id, id, seq, at, sender, text, rich, reply_to, files, run_id, run_attempt, run_index, goto, quote, addressed, initiative, event, steps, step_after, client_id, message_payload, mentions)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      this.roomId,
      id,
      event.seq,
      event.at,
      JSON.stringify(input.from),
      input.text,
      input.rich ? JSON.stringify(input.rich) : null,
      input.replyTo ?? null,
      input.files?.length ? JSON.stringify(input.files) : null,
      input.run?.runId ?? null,
      input.run?.attempt ?? null,
      input.run?.index ?? null,
      input.goto ?? null,
      input.quote ?? null,
      input.to ?? null,
      input.initiative?.reason ?? null,
      input.event ? JSON.stringify(input.event) : null,
      steps || null,
      open && steps ? open.after : null,
      input.clientId ?? null,
      JSON.stringify(event),
      input.mentions ? JSON.stringify(input.mentions) : null,
    )
  }

  private messagePayload(
    input: NewMessage,
    id: MessageId,
    open: { after: number; count: number } | null,
    steps: number,
    reply: ReplyPreview | undefined,
  ): Omit<Message, "seq" | "at"> {
    const message: Omit<Message, "seq" | "at"> = {
      id,
      from: input.from,
      text: input.text,
      ...(input.rich ? { rich: input.rich } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(reply ? { reply } : {}),
      ...(input.files?.length ? { files: input.files } : {}),
      ...(input.run ? { run: input.run } : {}),
      ...(open && steps ? { steps, stepAfter: open.after } : {}),
      ...(input.goto ? { goto: input.goto } : {}),
      ...(input.quote ? { quote: input.quote } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(input.initiative ? { initiative: input.initiative } : {}),
      ...(input.event ? { event: input.event } : {}),
    }
    return message
  }

  private get sql() {
    return this.storage.sql
  }

  private window(slug: string): { after: number; count: number } {
    let open = this.windows.get(slug)
    if (!open) {
      const after =
        this.sql
          .exec<{ seq: number }>(
            "SELECT seq FROM messages WHERE room_id = ? AND json_extract(sender, '$.kind') = 'agent' AND json_extract(sender, '$.slug') = ? AND addressed IS NULL ORDER BY seq DESC LIMIT 1",
            this.roomId,
            slug,
          )
          .toArray()[0]?.seq ?? 0
      open = { after, count: this.steps.count(slug, after) }
      this.windows.set(slug, open)
    }
    return open
  }

  hearStep(heard: HeardStep): RunStep | null {
    const open = this.window(heard.slug)
    if (heard.status === "running") {
      const step = this.steps.start(heard, open.after)
      if (step) open.count++
      return step
    }
    const ended = this.steps.finish(heard, open.after)
    if (ended?.fresh) open.count++
    return ended?.step ?? null
  }

  lastSeq(): number {
    return (
      this.sql
        .exec<{ seq: number | null }>(
          "SELECT max(seq) AS seq FROM (SELECT max(seq) AS seq FROM events WHERE room_id = ?1 UNION ALL SELECT max(seq) FROM messages WHERE room_id = ?1)",
          this.roomId,
        )
        .one().seq ?? 0
    )
  }

  readSeq(): number {
    return Number(this.meta("read_seq") ?? 0)
  }

  meta(key: string): string | null {
    return (
      this.scopedStorage.sql
        .exec<{ value: string }>(
          "SELECT value FROM owner_meta WHERE key = ?1 AND owner_meta.scope = 'room:' || ?2",
          key,
          this.roomId,
        )
        .toArray()[0]?.value ?? null
    )
  }

  setMeta(key: string, value: string): void {
    this.scopedStorage.sql.exec(
      "INSERT INTO owner_meta (key, value, scope) VALUES (?1, ?2, 'room:' || ?3) ON CONFLICT(key, scope) DO UPDATE SET value = excluded.value WHERE NOT value IS excluded.value",
      key,
      value,
      this.roomId,
    )
  }

  since(seq: number): RoomEvent[] {
    return this.sql
      .exec<{ seq: number; at: number; payload: string }>(
        "SELECT seq, at, payload FROM events WHERE room_id = ?1 AND seq > ?2 UNION ALL SELECT seq, at, message_payload AS payload FROM messages WHERE room_id = ?1 AND seq > ?2 AND message_payload IS NOT NULL ORDER BY seq",
        this.roomId,
        seq,
      )
      .toArray()
      .map((r) => ({ ...(JSON.parse(r.payload) as Body), seq: r.seq, at: r.at }) as RoomEvent)
  }

  catchUp(lastSeq: number): { t: "events"; events: RoomEvent[] } | { t: "reset"; snapshot: RoomSnapshot } {
    const last = this.lastSeq()
    if (lastSeq > last || last - lastSeq > REPLAY_LIMIT) return { t: "reset", snapshot: this.snapshot() }
    return { t: "events", events: this.since(lastSeq) }
  }

  snapshot(): RoomSnapshot {
    const rows = this.sql
      .exec<MessageRow>(
        "SELECT * FROM (SELECT * FROM messages WHERE room_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?) ORDER BY seq",
        this.roomId,
        SNAPSHOT_MESSAGES,
      )
      .toArray()
    const members = listMembers(this.scopedStorage, this.roomId)
    return {
      seq: this.lastSeq(),
      readSeq: this.readSeq(),
      members,
      messages: this.withReactions(rows),
      tasks: listTasks(this.scopedStorage, this.roomId),
      ...listSpace(this.scopedStorage, ROOM_TABLES, this.roomId),
      agents: [],
      asks: listAsks(this.scopedStorage.sql, this.roomId),
    }
  }

  openSteps(slugs: readonly string[]): RunStep[] {
    const open = slugs.flatMap((slug) => {
      const window = this.window(slug)
      return window.count ? [[slug, window.after] as const] : []
    })
    return this.steps.tails(new Map(open))
  }

  around(seq: number, before: number, after: number): Message[] {
    const older = before
      ? this.sql
          .exec<MessageRow>(
            "SELECT * FROM messages WHERE room_id = ? AND seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?",
            this.roomId,
            seq,
            before,
          )
          .toArray()
          .toReversed()
      : []
    const newer = after
      ? this.sql
          .exec<MessageRow>(
            "SELECT * FROM messages WHERE room_id = ? AND seq >= ? AND deleted_at IS NULL ORDER BY seq LIMIT ?",
            this.roomId,
            seq,
            after,
          )
          .toArray()
      : []
    return this.withReactions([...older, ...newer])
  }

  private previews(ids: readonly string[]): Map<string, ReplyPreview> {
    const out = new Map<string, ReplyPreview>()
    if (!ids.length) return out
    for (const r of this.sql
      .exec<MessageRow>(
        "SELECT * FROM messages WHERE room_id = ? AND seq IN (SELECT value FROM json_each(?))",
        this.roomId,
        messageSeqs(this.roomId, ids),
      )
      .toArray()) {
      const from = JSON.parse(r.sender) as Sender
      if (from.kind === "system") continue
      out.set(
        r.id,
        r.deleted_at !== null
          ? { seq: r.seq, from, text: "", gone: true }
          : { seq: r.seq, from, text: previewText(r.text, r.files ? (JSON.parse(r.files) as FileRef[]) : undefined) },
      )
    }
    return out
  }

  private withReactions(rows: MessageRow[]): Message[] {
    if (!rows.length) return []
    const replies = this.previews([...new Set(rows.flatMap((r) => (r.reply_to ? [r.reply_to] : [])))])
    const reactions = new Map<string, Reaction[]>()
    for (const x of this.sql
      .exec<{ message_id: string; actor: string; emoji: string }>(
        `SELECT message_id, actor, emoji FROM reactions WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?)) ORDER BY at`,
        this.roomId,
        JSON.stringify(rows.map((r) => r.id)),
      )
      .toArray()) {
      const list = reactions.get(x.message_id) ?? []
      list.push({ by: actorFromKey(x.actor), emoji: x.emoji })
      reactions.set(x.message_id, list)
    }
    return rows.map((r) => this.toMessage(r, reactions.get(r.id) ?? [], replies))
  }

  archiveSnapshot(day: string): ArchivedMessage[] {
    const start = Date.parse(day)
    return this.archiveRows(
      this.sql
        .exec<MessageRow>(
          "SELECT * FROM messages WHERE room_id = ? AND at >= ? AND at < ? ORDER BY seq",
          this.roomId,
          start,
          start + 86_400_000,
        )
        .toArray(),
    )
  }

  archiveOverrides(ids: string[]): ArchivedMessage[] {
    return this.archiveRows(
      this.sql
        .exec<MessageRow>(
          "SELECT * FROM messages WHERE room_id = ? AND seq IN (SELECT value FROM json_each(?)) ORDER BY seq",
          this.roomId,
          messageSeqs(this.roomId, ids),
        )
        .toArray(),
    )
  }

  private archiveRows(rows: MessageRow[]): ArchivedMessage[] {
    const messages = new Map(
      this.withReactions(rows.filter((row) => row.deleted_at === null)).map((message) => [
        message.id as string,
        message,
      ]),
    )
    const reactions = this.sql
      .exec<{ message_id: string; actor: string; emoji: string; at: number }>(
        "SELECT message_id, actor, emoji, at FROM reactions WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?)) ORDER BY message_id, actor",
        this.roomId,
        JSON.stringify(rows.map((row) => row.id)),
      )
      .toArray()
    const grouped = new Map<string, typeof reactions>()
    for (const reaction of reactions) {
      const list = grouped.get(reaction.message_id)
      if (list) list.push(reaction)
      else grouped.set(reaction.message_id, [reaction])
    }
    const previews = this.previews(rows.map((row) => row.id))
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      at: row.at,
      message: messages.get(row.id) ?? null,
      ...(previews.has(row.id) ? { preview: previews.get(row.id) } : {}),
      fingerprint: createHash("sha256")
        .update(JSON.stringify([row, grouped.get(row.id) ?? []]))
        .digest("hex"),
    }))
  }

  deleteArchived(snapshot: ArchivedMessage[]): void {
    const expected = new Map(snapshot.map((row) => [row.id, row.fingerprint]))
    const replayFloor = this.lastSeq() - REPLAY_LIMIT
    const ids = this.archiveOverrides(snapshot.map((row) => row.id))
      .filter((row) => row.seq <= replayFloor && expected.get(row.id) === row.fingerprint)
      .map((row) => row.id)
    const json = JSON.stringify(ids)
    const seqs = messageSeqs(this.roomId, ids)
    this.sql.exec(
      `INSERT OR IGNORE INTO archived_unread (room_id, seq)
       SELECT room_id, seq FROM messages WHERE room_id = ? AND seq IN (SELECT value FROM json_each(?))
       AND seq > ? AND deleted_at IS NULL AND json_extract(sender, '$.kind') != 'human' AND ${PUBLIC_MESSAGE}`,
      this.roomId,
      seqs,
      this.readSeq(),
    )
    this.sql.exec(
      "DELETE FROM reactions WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))",
      this.roomId,
      json,
    )
    this.sql.exec(
      "DELETE FROM messages WHERE room_id = ? AND seq IN (SELECT value FROM json_each(?))",
      this.roomId,
      seqs,
    )
  }

  message(id: string): Message | null {
    const row = this.sql
      .exec<MessageRow>(
        "SELECT * FROM messages WHERE room_id = ? AND seq = ? AND deleted_at IS NULL",
        this.roomId,
        messageSeq(this.roomId, id),
      )
      .toArray()[0]
    return row ? this.toMessage(row) : null
  }

  sentBefore(clientId: string): { id: MessageId; seq: number } | null {
    const row = this.sql
      .exec<{ id: string; seq: number }>(
        "SELECT id, seq FROM (SELECT id, seq, client_id FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT 200) WHERE client_id = ?",
        this.roomId,
        clientId,
      )
      .toArray()[0]
    return row ? { id: row.id as MessageId, seq: row.seq } : null
  }

  messageForRun(run: RunRef): { id: MessageId; seq: number } | null {
    const row = this.sql
      .exec<{ id: string; seq: number }>(
        `SELECT id, seq FROM messages WHERE room_id = ? AND run_id = ? AND run_attempt = ? AND run_index = ?`,
        this.roomId,
        run.runId,
        run.attempt,
        run.index,
      )
      .toArray()[0]
    return row ? { id: row.id as MessageId, seq: row.seq } : null
  }

  earlierAttempts(runId: string, attempt: number, fromIndex = 0): MessageId[] {
    return this.sql
      .exec<{ id: string }>(
        `SELECT id FROM messages WHERE room_id = ? AND run_id = ? AND run_attempt < ? AND run_index >= ? AND deleted_at IS NULL ORDER BY seq`,
        this.roomId,
        runId,
        attempt,
        fromIndex,
      )
      .toArray()
      .map((r) => r.id as MessageId)
  }

  adoptBubble(run: RunRef, text: string, replyTo: string | null): boolean {
    const row = this.sql
      .exec<{ id: string }>(
        `SELECT id FROM messages WHERE room_id = ? AND run_id = ? AND run_attempt < ? AND run_index = ? AND text = ? AND reply_to IS ? AND deleted_at IS NULL`,
        this.roomId,
        run.runId,
        run.attempt,
        run.index,
        text,
        replyTo,
      )
      .toArray()[0]
    if (!row) return false
    this.sql.exec(
      "UPDATE messages SET run_attempt = ? WHERE room_id = ? AND seq = ?",
      run.attempt,
      this.roomId,
      messageSeq(this.roomId, row.id),
    )
    return true
  }

  addMessage(input: NewMessage): { id: MessageId; seq: number; event: RoomEvent | null } {
    return this.storage.transactionSync(() => {
      const earlier = input.clientId
        ? this.sentBefore(input.clientId)
        : input.run
          ? this.messageForRun(input.run)
          : null
      if (earlier) return { ...earlier, event: null }
      const seq = this.lastSeq() + 1
      const id = messageIdAt(this.roomId, seq)
      const open = input.from.kind === "agent" && !input.to ? this.window(input.from.slug) : null
      const steps = open?.count ?? 0
      const reply = input.replyTo ? this.previews([input.replyTo]).get(input.replyTo) : undefined
      const message = this.messagePayload(input, id, open, steps, reply)
      const event = {
        t: "message",
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...message,
        seq,
        at: this.now(),
      } satisfies RoomEvent
      this.insertMessage(input, id, event, steps, open)
      if (open && input.from.kind === "agent") this.windows.set(input.from.slug, { after: event.seq, count: 0 })
      this.trim(event.seq)
      return { id, seq: event.seq, event }
    })
  }

  editMessage(id: MessageId, text: string, rich?: RichText): RoomEvent | null {
    return this.storage.transactionSync(() => {
      const current = this.message(id)
      if (!current || current.text === text) return null
      const event = this.append(actorKey(current.from), {
        t: "edit",
        messageId: id,
        text,
        ...(rich ? { rich } : {}),
      })
      this.sql.exec(
        "UPDATE messages SET text = ?, rich = ?, edited_at = ? WHERE room_id = ? AND seq = ?",
        text,
        rich ? JSON.stringify(rich) : current.rich ? JSON.stringify(current.rich) : null,
        event.at,
        this.roomId,
        current.seq,
      )
      return event
    })
  }

  deleteMessages(ids: readonly MessageId[], by: Actor): RoomEvent | null {
    return this.storage.transactionSync(() => {
      const live = ids.flatMap((id) => {
        const m = this.message(id)
        return m ? [m] : []
      })
      if (!live.length) return null
      const event = this.append(actorKey(by), { t: "delete", messageIds: live.map((m) => m.id) })
      for (const m of live) {
        this.sql.exec("UPDATE messages SET deleted_at = ? WHERE room_id = ? AND seq = ?", event.at, this.roomId, m.seq)
        this.sql.exec("DELETE FROM reactions WHERE room_id = ? AND message_id = ?", this.roomId, m.id)
      }
      return event
    })
  }

  react(messageId: MessageId, by: Actor, emoji: string | null, deliveryId?: string): RoomEvent | null {
    return this.storage.transactionSync(() => {
      if (deliveryId && this.reactionDelivered(deliveryId)) return null
      if (!this.message(messageId)) return null
      const key = actorKey(by)
      const current = this.sql
        .exec<{ emoji: string }>(
          "SELECT emoji FROM reactions WHERE room_id = ? AND message_id = ? AND actor = ?",
          this.roomId,
          messageId,
          key,
        )
        .toArray()[0]?.emoji
      if ((current ?? null) === emoji) {
        if (deliveryId) this.rememberReaction(messageId, key, deliveryId)
        return null
      }
      const event = this.append(key, { t: "react", messageId, by, emoji }, deliveryId)
      if (emoji === null)
        this.sql.exec(
          "DELETE FROM reactions WHERE room_id = ? AND message_id = ? AND actor = ?",
          this.roomId,
          messageId,
          key,
        )
      else
        this.sql.exec(
          "INSERT INTO reactions (room_id, message_id, actor, emoji, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, message_id, actor) DO UPDATE SET emoji = excluded.emoji, at = excluded.at",
          this.roomId,
          messageId,
          key,
          emoji,
          event.at,
        )
      return event
    })
  }

  reactionDelivered(deliveryId: string): boolean {
    return (
      this.meta(`reaction:${deliveryId}`) !== null ||
      this.sql
        .exec(
          "SELECT 1 FROM events, json_each(events.deliveries) AS delivery WHERE room_id = ? AND delivery.value = ? LIMIT 1",
          this.roomId,
          deliveryId,
        )
        .toArray().length > 0
    )
  }

  private rememberReaction(messageId: MessageId, actor: string, deliveryId: string): void {
    const receipt = this.sql
      .exec(
        "UPDATE events SET deliveries = json_insert(deliveries, '$[#]', ?) WHERE room_id = ? AND seq = (SELECT max(seq) FROM events WHERE room_id = ? AND kind = 'react' AND actor = ? AND json_extract(payload, '$.messageId') = ?) RETURNING seq",
        deliveryId,
        this.roomId,
        this.roomId,
        actor,
        messageId,
      )
      .toArray()
    if (!receipt.length) this.setMeta(`reaction:${deliveryId}`, messageId)
  }

  markRead(seq: number): RoomEvent | null {
    return this.storage.transactionSync(() => {
      const from = this.readSeq()
      const upTo = Math.min(seq, this.lastSeq())
      if (upTo <= from) return null
      const event = this.append("human", { t: "read", upTo })
      this.setMeta("read_seq", String(upTo))
      this.sql.exec("DELETE FROM archived_unread WHERE room_id = ? AND seq <= ?", this.roomId, upTo)
      return event
    })
  }

  unread(): number {
    return this.countNonHuman(this.readSeq(), Number.MAX_SAFE_INTEGER)
  }

  private countNonHuman(after: number, upTo: number): number {
    return this.sql
      .exec<{ n: number }>(
        `SELECT
         (SELECT count(*) FROM messages WHERE room_id = ?1 AND deleted_at IS NULL AND seq > ?2 AND seq <= ?3 AND json_extract(sender, '$.kind') != 'human' AND ${PUBLIC_MESSAGE}) +
         (SELECT count(*) FROM archived_unread WHERE room_id = ?1 AND seq > ?2 AND seq <= ?3) AS n`,
        this.roomId,
        after,
        upTo,
      )
      .one().n
  }

  lastAgentMessage(slug: string, after: number): { seq: number; text: string } | null {
    return (
      this.sql
        .exec<{ seq: number; text: string }>(
          "SELECT seq, text FROM messages WHERE room_id = ? AND seq > ? AND json_extract(sender, '$.kind') = 'agent' AND json_extract(sender, '$.slug') = ? ORDER BY seq DESC LIMIT 1",
          this.roomId,
          after,
          slug,
        )
        .toArray()[0] ?? null
    )
  }

  append(actor: string, body: Body, deliveryId?: string): RoomEvent {
    const at = this.now()
    const seq = this.lastSeq() + 1
    this.sql.exec(
      "INSERT INTO events (room_id, seq, kind, at, actor, payload, deliveries) VALUES (?, ?, ?, ?, ?, ?, ?)",
      this.roomId,
      seq,
      body.t,
      at,
      actor,
      JSON.stringify(body),
      JSON.stringify(deliveryId ? [deliveryId] : []),
    )
    this.trim(seq)
    return { ...body, seq, at } as RoomEvent
  }

  private trim(seq: number): void {
    if (seq % TRIM_EVERY === 0)
      this.sql.exec(
        "DELETE FROM events WHERE room_id = ? AND seq <= ? AND deliveries = '[]'",
        this.roomId,
        seq - KEEP_EVENTS,
      )
  }

  unansweredFor(agentSlug: AgentSlug, after: number, limit = 200): Pending[] {
    const members = listMembers(this.scopedStorage, this.roomId)
    const membership = this.sql
      .exec<{ added_seq: number; lead_seq: number }>(
        "SELECT added_seq, lead_seq FROM members WHERE room_id = ? AND slug = ? AND removed_at IS NULL",
        this.roomId,
        agentSlug,
      )
      .toArray()[0]
    if (!membership) return []
    return this.sql
      .exec<MessageRow>(
        "SELECT * FROM messages WHERE room_id = ? AND seq > ? AND json_extract(sender, '$.kind') = 'human' ORDER BY seq",
        this.roomId,
        Math.max(after, membership.added_seq),
      )
      .toArray()
      .flatMap((row): Pending[] => {
        const mentions = row.mentions ? (JSON.parse(row.mentions) as string[]) : tags(row.text)
        const replyTo = row.reply_to ? replyAddressees((id) => this.message(id), row.reply_to) : []
        const addressed =
          mentions.includes("all") ||
          members.some((member) => mentions.includes(member.slug) || replyTo.includes(member.slug))
        if (!addressed && row.seq <= membership.lead_seq) return []
        if (!resolveRecipients({ mentions, replyTo }, members).includes(agentSlug)) return []
        return [
          {
            envelope: {
              id: `human:${row.id}`,
              roomId: this.roomId as RoomId,
              from: { kind: "human" },
              body: row.text,
              ...(row.reply_to ? { replyTo: row.reply_to as MessageId } : {}),
              hop: 0,
              rootId: row.id,
              seq: row.seq,
            },
            mentions,
          },
        ]
      })
      .slice(0, limit)
  }

  private toMessage(r: MessageRow, preloaded?: Reaction[], replies?: ReadonlyMap<string, ReplyPreview>): Message {
    const reply = r.reply_to ? (replies ?? this.previews([r.reply_to])).get(r.reply_to) : undefined
    const reactions: Reaction[] =
      preloaded ??
      this.sql
        .exec<{ actor: string; emoji: string }>(
          "SELECT actor, emoji FROM reactions WHERE room_id = ? AND message_id = ? ORDER BY at",
          this.roomId,
          r.id,
        )
        .toArray()
        .map((x) => ({ by: actorFromKey(x.actor), emoji: x.emoji }))
    return {
      id: r.id as MessageId,
      seq: r.seq,
      at: r.at,
      from: JSON.parse(r.sender) as Sender,
      text: r.text,
      ...(r.rich ? { rich: JSON.parse(r.rich) as RichText } : {}),
      ...(r.reply_to ? { replyTo: r.reply_to as MessageId } : {}),
      ...(reply ? { reply } : {}),
      ...(r.files ? { files: JSON.parse(r.files) as FileRef[] } : {}),
      ...(r.run_id !== null ? { run: { runId: r.run_id, attempt: r.run_attempt ?? 0, index: r.run_index ?? 0 } } : {}),
      ...(r.steps ? { steps: r.steps, stepAfter: r.step_after ?? 0 } : {}),
      ...(r.edited_at !== null ? { editedAt: r.edited_at } : {}),
      ...(r.goto ? { goto: r.goto as RoomId } : {}),
      ...(r.client_id ? { clientId: r.client_id } : {}),
      ...(r.quote ? { quote: r.quote } : {}),
      ...(r.addressed ? { to: r.addressed as AgentSlug | "all" } : {}),
      ...(r.initiative ? { initiative: { reason: r.initiative } } : {}),
      ...(r.event ? { event: JSON.parse(r.event) as SystemEvent } : {}),
      ...(reactions.length ? { reactions } : {}),
    }
  }
}
