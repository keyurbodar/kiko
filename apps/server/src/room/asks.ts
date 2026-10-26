import type { AgentSlug, RoomId } from "@kiko/protocol"

export type Unanswered = { id: string; asker: AgentSlug; remote: RoomId | null; messageId: string }

type Asked = { id: string; askee: AgentSlug; send: string | null }

type RemoteAsk = { asker: AgentSlug; answer: string | null }

const KEEP_ASKS_MS = 7 * 86_400_000

export class Asks {
  constructor(
    private readonly sql: SqlStorage,
    private readonly roomId: string,
  ) {}

  expect(
    id: string,
    asker: AgentSlug,
    askee: AgentSlug,
    messageId: string,
    now: number,
    remote: RoomId | null = null,
  ): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO agent_asks (id, asker, askee, at, state, message_id, remote, room_id) VALUES (?1, ?2, ?3, ?4, 'closed', ?5, ?6, ?7)",
      id,
      asker,
      askee,
      now,
      messageId,
      remote,
      this.roomId,
    )
    if (Math.random() < 0.02)
      this.sql.exec("DELETE FROM agent_asks WHERE at < ?1 AND agent_asks.room_id = ?2", now - KEEP_ASKS_MS, this.roomId)
  }

  answer(from: AgentSlug, to: AgentSlug, text: string, send: string): string[] {
    const open = this.sql
      .exec<{ id: string; messageId: string }>(
        "SELECT id, message_id AS messageId FROM agent_asks WHERE (asker = ?1 AND askee = ?2 AND answer IS NULL AND remote IS NULL) AND agent_asks.room_id = ?3",
        to,
        from,
        this.roomId,
      )
      .toArray()
    for (const ask of open)
      this.sql.exec(
        "UPDATE agent_asks SET answer = ?1, answer_send = ?2 WHERE (id = ?3 AND answer IS NULL) AND agent_asks.room_id = ?4",
        text,
        send,
        ask.id,
        this.roomId,
      )
    return [...new Set(open.map((ask) => ask.messageId))]
  }

  waiting(asker: AgentSlug, messageId: string, except: string): boolean {
    return (
      this.sql
        .exec(
          "SELECT 1 FROM agent_asks WHERE (asker = ?1 AND message_id = ?2 AND answer IS NULL AND remote IS NULL AND id != ?3) AND agent_asks.room_id = ?4 LIMIT 1",
          asker,
          messageId,
          except,
          this.roomId,
        )
        .toArray().length > 0
    )
  }

  batch(asker: AgentSlug, messageId: string): Asked[] {
    return this.sql
      .exec<Asked>(
        "SELECT id, askee, answer_send AS send FROM agent_asks WHERE (asker = ?1 AND message_id = ?2 AND remote IS NULL) AND agent_asks.room_id = ?3 ORDER BY at, id",
        asker,
        messageId,
        this.roomId,
      )
      .toArray()
  }

  owes(askee: AgentSlug, asker: AgentSlug): boolean {
    return (
      this.sql
        .exec(
          "SELECT 1 FROM agent_asks WHERE (asker = ?1 AND askee = ?2 AND answer IS NULL AND remote IS NULL) AND agent_asks.room_id = ?3 LIMIT 1",
          asker,
          askee,
          this.roomId,
        )
        .toArray().length > 0
    )
  }

  answerRemote(from: AgentSlug, to: AgentSlug, text: string): { id: string; remote: RoomId }[] {
    const rows = this.sql
      .exec<{ id: string; remote: RoomId }>(
        "SELECT id, remote FROM agent_asks WHERE (asker = ?1 AND askee = ?2 AND answer IS NULL AND NOT remote IS NULL) AND agent_asks.room_id = ?3 ORDER BY at",
        to,
        from,
        this.roomId,
      )
      .toArray()
    for (const row of rows)
      this.sql.exec(
        "UPDATE agent_asks SET answer = ?1 WHERE id = ?2 AND agent_asks.room_id = ?3",
        text,
        row.id,
        this.roomId,
      )
    return rows
  }

  remote(id: string): RemoteAsk | null {
    return (
      this.sql
        .exec<RemoteAsk>(
          "SELECT asker, answer FROM agent_asks WHERE (id = ?1 AND NOT remote IS NULL) AND agent_asks.room_id = ?2",
          id,
          this.roomId,
        )
        .toArray()[0] ?? null
    )
  }

  unanswered(askee: AgentSlug, messageIds: readonly string[]): Unanswered[] {
    if (!messageIds.length) return []
    return this.sql
      .exec<Unanswered>(
        "SELECT id, asker, remote, message_id AS messageId FROM agent_asks WHERE (askee = ?1 AND answer IS NULL AND message_id IN (SELECT value FROM JSON_EACH(?2))) AND agent_asks.room_id = ?3 ORDER BY at",
        askee,
        JSON.stringify(messageIds),
        this.roomId,
      )
      .toArray()
  }

  settle(id: string, text: string): boolean {
    return (
      this.sql.exec(
        "UPDATE agent_asks SET answer = ?1 WHERE (id = ?2 AND answer IS NULL) AND agent_asks.room_id = ?3",
        text,
        id,
        this.roomId,
      ).rowsWritten > 0
    )
  }
}
