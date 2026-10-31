import * as Schema from "effect/Schema"
import type { JsonObject } from "@earendil-works/pi-ai"
import type { Life } from "@kiko/memory/life"
import { cleanLine, MAX_NAP_FAILS, NAP_SYSTEM, spanOf } from "@kiko/memory/optmem"
import { candidates, type CaptureCount, type CapturePolicy, captureWithJudge, mergePolicy } from "@kiko/memory/capture"
import type { Answer, Judge, Question } from "@kiko/memory/judge"
import {
  KIKO,
  type MemoryModel,
  type MemoryOp,
  type MemoryResult,
  type ProviderInfo,
  type RoomId,
} from "@kiko/protocol"
import type { UserSettingsPatch } from "@kiko/protocol"
import { userModels } from "../agent/factory"
import { parseModelRef } from "../agent/thinking"
import { agentModel } from "./agent-models"
import { DEV } from "../lib/dev-guard"
import { deleteSetting, getSetting, setSetting } from "../lib/settings"
import type { CredentialVault } from "./credentials"
import { findProvider } from "../models/catalog"
import { pickJudge, providerUses, type TurnContext } from "./turn-context"

class ModelCallFailed extends Schema.TaggedError<ModelCallFailed>()("ModelCallFailed", {
  stopReason: Schema.String,
  message: Schema.String,
}) {}

const NAPS_PER_RUN = 1
const MAX_NAPS = 4
const COMPRESS_TIMEOUT_MS = 120_000
const MEMORY_USAGE = "memory_usage"
const MEMORY_MODEL = "memory_model"
const MEMORY_POLICY = "memory_policy"
const REFUSED = /\((401|403)\)/
const CAPTURE_QUEUE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const CAPTURE_PER_RUN = 24
const CAPTURE_CHUNK = 4
const CAPTURE_TEXT_MAX = 8_000
const CAPTURE_TIMEOUT_MS = 8_000

export type MemoryDeps = {
  chat: (roomId: RoomId) => import("@kiko/protocol").Chat | null
  sql: SqlStorage
  fetch: typeof fetch
  countOutgoing: () => void
  life: Life
  label: string
  credentials: () => CredentialVault
  turn: (provider: string) => Promise<TurnContext>
  waitUntil: (work: Promise<unknown>) => void
}

export class MemoryCapture {
  private readonly sql: SqlStorage
  private readonly life: Life
  private readonly d: MemoryDeps
  #compressing = 0

  constructor(d: MemoryDeps) {
    this.d = d
    this.sql = d.sql
    this.life = d.life
  }

  policy(): CapturePolicy {
    return mergePolicy(getSetting(this.sql, MEMORY_POLICY))
  }

  capturable(roomId: RoomId): boolean {
    const chat = this.d.chat(roomId)
    return chat !== null && !chat.private
  }

  captures(): boolean {
    return !this.captureOff() && this.judgeKey() !== null
  }

  private captureOff(): boolean {
    return this.policy().capture === "off"
  }

  judgeKey(): ProviderInfo | null {
    return pickJudge(this.d.credentials().listProviders(), (p) => p.problem === "key_refused")
  }

  private judgeConfigured(): boolean {
    return pickJudge(this.d.credentials().listProviders(), () => false) !== null
  }

  judgeFor(timeoutMs: number): Judge | null {
    return this.judgeKey() ? this.judge(timeoutMs) : null
  }

  judge(timeoutMs: number): Judge {
    return async <K extends string>(
      state: JsonObject,
      questions: Record<K, Question>,
    ): Promise<Record<K, Answer> | null> => {
      const key = this.judgeKey()
      if (!key) return null
      try {
        const auth = (await this.d.turn(key.provider)).auth
        if (!auth) return null
        const { models } = userModels(async () => auth, `memory-${this.d.label}`, this.d.fetch, this.d.countOutgoing)
        const model = models.getModelsOfType("classifier", key.provider)[0]
        if (!model) return null
        const result = await models.classify(model, { state, questions }, { signal: AbortSignal.timeout(timeoutMs) })
        this.count({ jev_input: result.usage?.input ?? 0, jev_output: result.usage?.output ?? 0 })
        if (result.stopReason === "stop") return result.answers as Record<K, Answer>
        if (REFUSED.test(result.errorMessage ?? "")) {
          this.d.credentials().setProblem(key.provider, "key_refused")
          this.count({ jev_refused: 1 })
        } else {
          this.count({ jev_errors: 1 })
          console.error(
            `judge ${key.provider} ${result.stopReason} ${/\((\d{3})\)/.exec(result.errorMessage ?? "")?.[1] ?? ""}`,
          )
        }
        return null
      } catch (error) {
        this.count({ jev_errors: 1 })
        console.error(`judge ${key.provider} failed: ${error instanceof Error ? error.name : "error"}`)
        return null
      }
    }
  }

  count(delta: Record<string, number>): void {
    if (!DEV || !Object.values(delta).some((n) => n !== 0)) return
    const spent = this.usage()
    for (const [k, n] of Object.entries(delta)) if (n) spent[k] = (spent[k] ?? 0) + n
    setSetting(this.sql, MEMORY_USAGE, JSON.stringify(spent))
  }

  usage(): Record<string, number> {
    return JSON.parse(getSetting(this.sql, MEMORY_USAGE) ?? "{}") as Record<string, number>
  }

  private tally(c: CaptureCount): void {
    this.count({ facts_added: c.added, facts_replaced: c.replaced, facts_same: c.same, facts_private: c.private })
  }

  private queued(roomId: string, messageId: string, text: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM capture_queue WHERE room_id = ? AND message_id = ? AND text = ?", roomId, messageId, text)
        .toArray().length > 0
    )
  }

  private dequeue(roomId: string, messageIds: readonly string[]): void {
    this.sql.exec(
      "DELETE FROM capture_queue WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))",
      roomId,
      JSON.stringify(messageIds),
    )
  }

  private expire(now: number): void {
    this.sql.exec("DELETE FROM capture_queue WHERE queued_at < ?", now - CAPTURE_QUEUE_AGE_MS)
  }

  pending(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM capture_queue").one().n
  }

  async captureHuman(roomId: RoomId, items: { messageId: string; text: string; at: number }[]): Promise<void> {
    if (this.captureOff() || !this.judgeConfigured() || !this.capturable(roomId)) return
    const rows = items.flatMap((i) =>
      i.messageId && candidates(i.text).length
        ? [{ id: i.messageId, text: i.text.slice(0, CAPTURE_TEXT_MAX), at: i.at }]
        : [],
    )
    if (!rows.length) return
    const inserted = this.sql.exec(
      "INSERT OR IGNORE INTO capture_queue (room_id, message_id, text, at, queued_at) SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.text'), json_extract(value, '$.at'), ? FROM json_each(?)",
      roomId,
      Date.now(),
      JSON.stringify(rows),
    )
    if (inserted.rowsWritten) this.expire(Date.now())
    this.d.waitUntil(
      this.captureNow().catch((error: unknown) =>
        console.error(`memory capture failed: ${error instanceof Error ? error.message : String(error)}`),
      ),
    )
  }

  async captureNow(): Promise<void> {
    if (this.captureOff() || !this.judgeConfigured()) {
      if (this.sql.exec("SELECT 1 FROM capture_queue LIMIT 1").toArray().length)
        this.sql.exec("DELETE FROM capture_queue")
      return
    }
    if (this.judgeKey() === null) {
      this.expire(Date.now())
      return
    }
    type QueueRow = { room_id: RoomId; message_id: string; text: string; at: number }
    const queue = this.sql
      .exec<QueueRow>(
        "SELECT room_id, message_id, text, at FROM capture_queue ORDER BY queued_at, at LIMIT ?",
        CAPTURE_PER_RUN,
      )
      .toArray()
    for (const r of queue.filter((r) => !this.capturable(r.room_id))) this.dequeue(r.room_id, [r.message_id])
    const rows = queue.filter((r) => this.capturable(r.room_id))
    const judge = this.judge(CAPTURE_TIMEOUT_MS)
    for (let i = 0; i < rows.length; i += CAPTURE_CHUNK) {
      const chunk = rows.slice(i, i + CAPTURE_CHUNK)
      this.count({ capture_jev: 1 })
      const out = await captureWithJudge(
        this.life,
        judge,
        chunk.map((r) => ({
          heard: { messageId: r.message_id, text: r.text, at: r.at },
          ref: `room:${r.room_id}:msg:${r.message_id}`,
          keep: () => this.queued(r.room_id, r.message_id, r.text),
        })),
      )
      if (!out) continue
      this.tally(out)
      for (const r of chunk) if (this.queued(r.room_id, r.message_id, r.text)) this.dequeue(r.room_id, [r.message_id])
    }
  }

  async napLife(): Promise<void> {
    for (const span of this.life.pending(NAPS_PER_RUN)) {
      const prompt = this.life.prompt(span)
      if (!prompt) {
        this.life.settle(span, null)
        continue
      }
      const out = await this.compress(prompt)
      if (this.life.prompt(span) !== prompt) continue
      if ("retryAt" in out) return
      if ("error" in out && this.life.tree.failed(span) < MAX_NAP_FAILS)
        return void console.error(`memory nap failed: ${out.error}`)
      this.life.settle(span, "text" in out ? out.text : null)
    }
  }

  async compress(prompt: string): Promise<{ text: string } | { retryAt: number } | { error: string }> {
    if (this.#compressing >= MAX_NAPS) return { retryAt: Date.now() + 5_000 + Math.floor(Math.random() * 5_000) }
    this.#compressing++
    try {
      const kiko = agentModel(this.sql, KIKO)
      const ref = this.memoryModel() ?? (kiko ? parseModelRef(kiko.model) : null)
      if (!ref) return { retryAt: Date.now() + 10 * 60_000 }
      const answer = await this.complete(ref, NAP_SYSTEM, prompt)
      if (answer === null) return { retryAt: Date.now() + 10 * 60_000 }
      const line = cleanLine(answer)
      return line ? { text: line } : { error: "the model wrote no line" }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.#compressing--
    }
  }

  private async complete(
    ref: { provider: string; modelId: string },
    system: string,
    prompt: string,
  ): Promise<string | null> {
    const { provider, modelId } = ref
    const auth = (await this.d.turn(provider)).auth
    if (!auth) return null
    const { models, settings } = userModels(
      async () => auth,
      `memory-${this.d.label}`,
      this.d.fetch,
      this.d.countOutgoing,
    )
    const model = models.getModel(provider, modelId)
    if (!model) return null
    const headers = settings.stream?.headers
    const reply = await models.completeSimple(
      model,
      { systemPrompt: system, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      {
        headers,
        signal: AbortSignal.timeout(COMPRESS_TIMEOUT_MS),
        ...(model.reasoning && model.thinkingLevelMap?.off === null ? { reasoning: "minimal" as const } : {}),
      },
    )
    const failed = reply.stopReason === "error" || reply.stopReason === "aborted"
    this.count({
      input: reply.usage?.input ?? 0,
      output: reply.usage?.output ?? 0,
      cacheRead: reply.usage?.cacheRead ?? 0,
      calls: 1,
      failed: failed ? 1 : 0,
    })
    if (failed)
      throw new ModelCallFailed({
        stopReason: reply.stopReason,
        message: `the model call failed: ${reply.stopReason} ${(reply.errorMessage ?? "").slice(0, 160)}`,
      })
    return reply.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("")
  }

  private memoryModel(): MemoryModel {
    const raw = getSetting(this.sql, MEMORY_MODEL)
    return raw ? (JSON.parse(raw) as MemoryModel) : null
  }

  async call(op: MemoryOp): Promise<MemoryResult> {
    const now = Date.now()
    switch (op.op) {
      case "list": {
        const lines = this.life.list(op.before ?? null, op.limit ?? 50)
        return { ok: true, lines, next: lines[lines.length - 1]?.pos ?? null }
      }
      case "view":
        return { ok: true, text: this.life.view(now).split("\n").filter(Boolean) }
      case "search":
        return { ok: true, lines: this.life.recall(op.query, 30), next: null }
      case "zoom": {
        const span = spanOf(op.id)
        return span ? { ok: true, text: this.life.zoom(span, now) } : { ok: false, error: "not a summary id" }
      }
      case "note": {
        const out = this.life.append(op.text, "you")
        return out.ok ? { ok: true } : out
      }
      case "pin":
        return this.life.pin(op.pos, op.pinned)
      case "redact":
        if (!this.life.redact(op.pos)) return { ok: false, error: "no such memory" }
        return { ok: true }
      case "model":
        return { ok: true, model: this.memoryModel() }
      case "set_model": {
        const model = op.model
        if (
          model &&
          !findProvider(model.provider)
            ?.getModels()
            .some((m) => m.id === model.modelId)
        )
          return { ok: false, error: "no such model" }
        if (model) setSetting(this.sql, MEMORY_MODEL, JSON.stringify(model))
        else deleteSetting(this.sql, MEMORY_MODEL)
        return { ok: true }
      }
    }
  }

  setCapture(capture: NonNullable<UserSettingsPatch["capture"]>): void {
    let stored: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(getSetting(this.sql, MEMORY_POLICY) ?? "{}")
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
    } catch {}
    setSetting(this.sql, MEMORY_POLICY, JSON.stringify({ ...stored, capture }))
  }

  describe(p: ProviderInfo): ProviderInfo {
    return { ...p, ...providerUses(p.provider) }
  }
}
