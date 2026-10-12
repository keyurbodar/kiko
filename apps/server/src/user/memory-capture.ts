import type { JsonObject } from "@earendil-works/pi-ai"
import type { Alarms } from "@yuki/durable/alarm"
import type { Life } from "@yuki/memory/life"
import { cleanLine, MAX_NAP_FAILS, NAP_SYSTEM, spanOf } from "@yuki/memory/optmem"
import { applyOps, CAPTURE_SYSTEM, captureActive, candidates, type CaptureCount, type CapturePolicy, capturePrompt, captureWithJudge, type Heard, knownFor, mergePolicy, parseCapture } from "@yuki/memory/capture"
import { type Answer, boolOf, type Judge, type Question } from "@yuki/memory/judge"
import { parseNapLoops } from "@yuki/memory/loops"
import type { MemoryModel, MemoryOp, MemoryResult, RoomId } from "@yuki/protocol"
import type { UserSettingsPatch } from "@yuki/protocol/schema"
import { DEFAULT_MODEL, userModels } from "../agent/factory"
import { deleteSetting, getSetting, setSetting } from "../lib/settings"
import type { CredentialVault, ProviderInfo } from "./credentials"
import { getChat } from "./chats"
import { findProvider, pickJudge, providerUses, type TurnContext } from "./turn-context"
import type { InitiativeLoops } from "./initiative-loops"

export const LIFE_WAKEUP = "life_naps"
const NAPS_PER_ALARM = 4
const MAX_NAPS = 4
const COMPRESS_TIMEOUT_MS = 120_000
const MEMORY_USAGE = "memory_usage"
const MEMORY_MODEL = "memory_model"
const MEMORY_POLICY = "memory_policy"
const JUDGE_MODEL = "judge_model"
const refusedKey = (provider: string) => `${provider}_refused`
const REFUSED = /\((401|403)\)/
export const CAPTURE_WAKEUP = "life_capture"
const CAPTURE_QUEUE_MAX = 200
const CAPTURE_PER_ALARM = 24
// Rows per judge request. A request grows with rows times candidates times known facts, and a long one times out.
const CAPTURE_CHUNK = 4
// Passes a row may fail before it is dropped, so a chunk the judge never answers cannot be reselected forever.
const CAPTURE_TRIES = 5
export const CAPTURE_TEXT_MAX = 8_000
export const CAPTURE_TIMEOUT_MS = 8_000
const RERANK_TIMEOUT_MS = 1_500
const RERANK_LINES_MAX = 30
const NAP_APPLIED_FOR = 7 * 86_400_000

export type MemoryDeps = {
  sql: SqlStorage
  life: Life
  alarms: Alarms
  label: string
  credentials: () => CredentialVault
  turn: (provider: string) => Promise<TurnContext>
  loops: () => InitiativeLoops
}

export class MemoryCapture {
  private readonly sql: SqlStorage
  private readonly life: Life
  private readonly alarms: Alarms
  private readonly d: MemoryDeps
  #compressing = 0

  constructor(d: MemoryDeps) {
    this.d = d
    this.sql = d.sql
    this.life = d.life
    this.alarms = d.alarms
  }

  private setting(key: string): string | null {
    return getSetting(this.sql, key)
  }

  private putSetting(key: string, value: string): void {
    setSetting(this.sql, key, value)
  }

  policy(): CapturePolicy {
    return mergePolicy(this.setting(MEMORY_POLICY))
  }

  capturable(roomId: RoomId): boolean {
    const chat = getChat(this.sql, roomId)
    return chat !== null && !chat.private
  }

  captures(): boolean {
    return captureActive(this.policy(), this.judgeKey() !== null)
  }

  private refused(p: ProviderInfo): boolean {
    return this.setting(refusedKey(p.provider)) === p.last4
  }

  judgeKey(): { key: ProviderInfo; model: string | null } | null {
    return pickJudge(this.d.credentials().listProviders(), (p) => this.refused(p), this.setting(JUDGE_MODEL))
  }

  judgeFor(timeoutMs: number): Judge | null {
    return this.judgeKey() ? this.judge(timeoutMs) : null
  }

  judge(timeoutMs: number): Judge {
    return async <K extends string>(state: JsonObject, questions: Record<K, Question>): Promise<Record<K, Answer> | null> => {
      const picked = this.judgeKey()
      if (!picked) return null
      const { key } = picked
      try {
        const auth = (await this.d.turn(key.provider)).auth
        if (!auth) return null
        const { models } = userModels(async () => auth, `memory-${this.d.label}`)
        const model = (picked.model ? models.getModelOfType("classifier", key.provider, picked.model) : undefined) ?? models.getModelsOfType("classifier", key.provider)[0]
        if (!model) return null
        const result = await models.classify(model, { state, questions }, { signal: AbortSignal.timeout(timeoutMs) })
        this.count({ jev_input: result.usage?.input ?? 0, jev_output: result.usage?.output ?? 0 })
        if (result.stopReason === "stop") return result.answers as Record<K, Answer>
        if (REFUSED.test(result.errorMessage ?? "")) {
          this.putSetting(refusedKey(key.provider), key.last4)
          this.count({ jev_refused: 1 })
        } else {
          this.count({ jev_errors: 1 })
          console.error(`judge ${key.provider} ${result.stopReason} ${/\((\d{3})\)/.exec(result.errorMessage ?? "")?.[1] ?? ""}`)
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
    const spent = JSON.parse(this.setting(MEMORY_USAGE) ?? "{}") as Record<string, number>
    for (const [k, n] of Object.entries(delta)) if (n) spent[k] = (spent[k] ?? 0) + n
    this.putSetting(MEMORY_USAGE, JSON.stringify(spent))
  }

  usage(): Record<string, number> {
    return JSON.parse(this.setting(MEMORY_USAGE) ?? "{}") as Record<string, number>
  }

  private tally(c: CaptureCount): void {
    this.count({ facts_added: c.added, facts_replaced: c.replaced, facts_same: c.same, facts_private: c.private })
  }

  private async armCapture(): Promise<void> {
    const q = this.sql.exec<{ n: number; oldest: number | null; newest: number | null }>("SELECT count(*) AS n, min(queued_at) AS oldest, max(queued_at) AS newest FROM capture_queue").one()
    if (q.n && !this.captures()) return this.captureNow()
    if (!q.n) return this.alarms.clearWakeup(CAPTURE_WAKEUP)
    const p = this.policy()
    const { oldest, newest } = q
    if (oldest === null || newest === null) throw new Error("capture queue rows have no timestamps")
    await this.alarms.setWakeup(CAPTURE_WAKEUP, this.judgeKey() ? newest + p.jevDelayMs : q.n >= p.batch ? Date.now() : oldest + p.idleMs)
  }

  private queued(roomId: string, messageId: string, text: string): boolean {
    return this.sql.exec("SELECT 1 FROM capture_queue WHERE room_id = ? AND message_id = ? AND text = ?", roomId, messageId, text).toArray().length > 0
  }

  private dequeue(roomId: string, messageIds: readonly string[]): void {
    this.sql.exec("DELETE FROM capture_queue WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))", roomId, JSON.stringify(messageIds))
  }

  async captureHuman(roomId: RoomId, items: { messageId: string; text: string; at: number }[]): Promise<void> {
    if (!this.captures() || !this.capturable(roomId)) return
    const rows = items.flatMap((i) => (i.messageId && candidates(i.text).length ? [{ id: i.messageId, text: i.text.slice(0, CAPTURE_TEXT_MAX), at: i.at }] : []))
    if (!rows.length) return
    this.sql.exec(
      "INSERT OR IGNORE INTO capture_queue (room_id, message_id, text, at, queued_at) SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.text'), json_extract(value, '$.at'), ? FROM json_each(?)",
      roomId,
      Date.now(),
      JSON.stringify(rows),
    )
    this.sql.exec("DELETE FROM capture_queue WHERE rowid NOT IN (SELECT rowid FROM capture_queue ORDER BY queued_at DESC LIMIT ?)", CAPTURE_QUEUE_MAX)
    await this.armCapture()
  }

  async captureNow(): Promise<void> {
    const policy = this.policy()
    if (!this.captures()) {
      this.sql.exec("DELETE FROM capture_queue")
      return this.alarms.clearWakeup(CAPTURE_WAKEUP)
    }
    type QueueRow = { room_id: RoomId; message_id: string; text: string; at: number; queued_at: number; attempts: number }
    let rows = this.sql.exec<QueueRow>("SELECT room_id, message_id, text, at, queued_at, attempts FROM capture_queue ORDER BY queued_at, at LIMIT ?", CAPTURE_PER_ALARM).toArray()
    for (const r of rows.filter((r) => !this.capturable(r.room_id))) this.dequeue(r.room_id, [r.message_id])
    rows = rows.filter((r) => this.capturable(r.room_id))
    let learned = false
    if (this.judgeKey()) {
      const judge = this.judge(CAPTURE_TIMEOUT_MS)
      // A chunk the judge does not answer stays queued, up to CAPTURE_TRIES passes. The chunks around it still settle, so one slow chunk cannot hold up the queue.
      const left: QueueRow[] = []
      for (let i = 0; i < rows.length; i += CAPTURE_CHUNK) {
        const chunk = rows.slice(i, i + CAPTURE_CHUNK)
        this.count({ capture_jev: 1 })
        const out = await captureWithJudge(
          this.life,
          judge,
          chunk.map((r) => ({ heard: { messageId: r.message_id, text: r.text, at: r.at }, ref: `room:${r.room_id}:msg:${r.message_id}`, keep: () => this.queued(r.room_id, r.message_id, r.text) })),
          policy,
        )
        if (!out) {
          for (const r of chunk) {
            if (r.attempts + 1 >= CAPTURE_TRIES) this.dequeue(r.room_id, [r.message_id])
            else {
              this.sql.exec("UPDATE capture_queue SET attempts = attempts + 1 WHERE room_id = ? AND message_id = ?", r.room_id, r.message_id)
              left.push(r)
            }
          }
          continue
        }
        this.tally(out)
        learned ||= out.added + out.replaced > 0
        for (const r of chunk) if (this.queued(r.room_id, r.message_id, r.text)) this.dequeue(r.room_id, [r.message_id])
      }
      rows = left
      if (rows.length && policy.capture === "auto") {
        if (learned) await this.armNaps()
        return void (await this.alarms.setWakeup(CAPTURE_WAKEUP, Date.now() + policy.idleMs))
      }
    } else {
      const total = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM capture_queue").one().n
      if (total < policy.batch && (rows[0]?.queued_at ?? Date.now()) + policy.idleMs > Date.now()) rows = []
    }
    const rooms = new Map<RoomId, QueueRow[]>()
    for (const r of rows) rooms.set(r.room_id, [...(rooms.get(r.room_id) ?? []), r])
    for (const [roomId, batch] of rooms) {
      const out = await this.captureByModel(roomId, batch.map((r) => ({ messageId: r.message_id, text: r.text, at: r.at })))
      if (out === "later") {
        if (learned) await this.armNaps()
        return void (await this.alarms.setWakeup(CAPTURE_WAKEUP, Date.now() + policy.idleMs))
      }
      learned ||= out
    }
    if (learned) await this.armNaps()
    await this.armCapture()
  }

  private async captureByModel(roomId: RoomId, heard: Heard[]): Promise<boolean | "later"> {
    const known = knownFor(this.life, heard)
    let answer: string | null
    try {
      answer = await this.complete(this.memoryModel() ?? DEFAULT_MODEL, CAPTURE_SYSTEM, capturePrompt(heard, known))
    } catch (error) {
      console.error(`capture by model failed: ${error instanceof Error ? error.message.slice(0, 200) : "error"}`)
      return "later"
    }
    if (answer === null) return "later"
    this.count({ capture_model: 1 })
    if (heard.some((h) => !this.queued(roomId, h.messageId, h.text))) return false
    const out = applyOps(this.life, parseCapture(answer, new Set(known.map((k) => k.pos)), heard.length), heard.map((h) => ({ ref: `room:${roomId}:msg:${h.messageId}`, at: h.at })))
    this.tally(out)
    this.dequeue(roomId, heard.map((h) => h.messageId))
    return out.added + out.replaced > 0
  }

  async armNaps(): Promise<void> {
    if (this.life.pending(1).length) await this.alarms.setWakeup(LIFE_WAKEUP, Date.now() + 2_000)
  }

  async napLife(): Promise<void> {
    for (const span of this.life.pending(NAPS_PER_ALARM)) {
      const prompt = this.life.prompt(span)
      if (!prompt) {
        this.life.settle(span, null)
        continue
      }
      const out = await this.compress(prompt)
      if ("retryAt" in out) return void (await this.alarms.setWakeup(LIFE_WAKEUP, out.retryAt))
      if ("error" in out && this.life.tree.failed(span) < MAX_NAP_FAILS) throw new Error(out.error)
      this.life.settle(span, "text" in out ? out.text : null)
    }
    await this.armNaps()
  }

  async compress(prompt: string, page?: { roomId: RoomId; at: number; span?: { lo: number; hi: number } }): Promise<{ text: string } | { retryAt: number } | { error: string }> {
    if (this.#compressing >= MAX_NAPS) return { retryAt: Date.now() + 5_000 + Math.floor(Math.random() * 5_000) }
    this.#compressing++
    try {
      const loops = page ? this.d.loops().initiative.napPrompt(page.roomId, prompt, page.at) : null
      const answer = await this.complete(this.memoryModel() ?? DEFAULT_MODEL, loops?.system ?? NAP_SYSTEM, loops?.prompt ?? prompt)
      if (answer === null) return { retryAt: Date.now() + 10 * 60_000 }
      const line = cleanLine(loops && page ? ((await this.napOnce(page, prompt)) ? this.d.loops().initiative.napApply(page.roomId, answer, loops.known, page.at, page.span) : parseNapLoops(answer, loops.known).summary) ?? "" : answer)
      return line ? { text: line } : { error: "the model wrote no line" }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.#compressing--
    }
  }

  private async napOnce(page: { roomId: RoomId; span?: { lo: number; hi: number } }, prompt: string): Promise<boolean> {
    if (!page.span) return true
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt)))
    const id = `${page.roomId}:${page.span.lo}-${page.span.hi}:${[...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`
    const now = Date.now()
    this.sql.exec("DELETE FROM nap_applied WHERE at < ?", now - NAP_APPLIED_FOR)
    return this.sql.exec("INSERT OR IGNORE INTO nap_applied (id, at) VALUES (?, ?)", id, now).rowsWritten > 0
  }

  private async complete(ref: { provider: string; modelId: string }, system: string, prompt: string): Promise<string | null> {
    const { provider, modelId } = ref
    const auth = (await this.d.turn(provider)).auth
    if (!auth) return null
    const { models, settings } = userModels(async () => auth, `memory-${this.d.label}`)
    const model = models.getModel(provider, modelId)
    if (!model) return null
    const headers = settings.stream?.headers
    const reply = await models.completeSimple(
      model,
      { systemPrompt: system, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      { headers, signal: AbortSignal.timeout(COMPRESS_TIMEOUT_MS), ...(model.reasoning && model.thinkingLevelMap?.off === null ? { reasoning: "minimal" as const } : {}) },
    )
    const spent = JSON.parse(this.setting(MEMORY_USAGE) ?? "{}") as Record<string, number>
    for (const k of ["input", "output", "cacheRead"] as const) spent[k] = (spent[k] ?? 0) + (reply.usage?.[k] ?? 0)
    spent.calls = (spent.calls ?? 0) + 1
    const failed = reply.stopReason === "error" || reply.stopReason === "aborted"
    if (failed) spent.failed = (spent.failed ?? 0) + 1
    this.putSetting(MEMORY_USAGE, JSON.stringify(spent))
    if (failed) throw new Error(`the model call failed: ${reply.stopReason} ${(reply.errorMessage ?? "").slice(0, 160)}`)
    return reply.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("")
  }

  async rerank(query: string, lines: { id: string; text: string }[]): Promise<string[] | null> {
    if (!this.judgeKey()) return null
    const shown = lines.slice(0, RERANK_LINES_MAX)
    if (!shown.length) return []
    const questions: Record<string, Question> = {}
    shown.forEach((_, i) => {
      questions[`l${i}`] = { type: "bool", instructions: `Does \`lines[${i}]\` help answer \`query\`?`, criteria: { true: "it holds part of the answer", false: "it does not help answer it" } }
    })
    const answers = await this.judge(RERANK_TIMEOUT_MS)({ query, lines: shown.map((l) => l.text) }, questions)
    if (!answers) return null
    this.count({ rerank_jev: 1 })
    const policy = this.policy()
    return shown
      .map((l, i) => ({ id: l.id, p: boolOf(answers[`l${i}`]) }))
      .filter((x) => x.p >= policy.rerankMin)
      .sort((a, b) => b.p - a.p)
      .slice(0, policy.recallMax)
      .map((x) => x.id)
  }

  private memoryModel(): MemoryModel {
    const raw = this.setting(MEMORY_MODEL)
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
        if (out.ok) await this.armNaps()
        return out.ok ? { ok: true } : out
      }
      case "pin":
        return this.life.pin(op.pos, op.pinned)
      case "redact":
        if (!this.life.redact(op.pos)) return { ok: false, error: "no such memory" }
        await this.armNaps()
        return { ok: true }
      case "model":
        return { ok: true, model: this.memoryModel() }
      case "set_model": {
        const model = op.model
        if (model && !findProvider(model.provider)?.getModels().some((m) => m.id === model.modelId)) return { ok: false, error: "no such model" }
        if (model) this.putSetting(MEMORY_MODEL, JSON.stringify(model))
        else deleteSetting(this.sql, MEMORY_MODEL)
        return { ok: true }
      }
    }
  }

  setCapture(capture: NonNullable<UserSettingsPatch["capture"]>): void {
    let stored: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(this.setting(MEMORY_POLICY) ?? "{}")
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
    } catch {}
    this.putSetting(MEMORY_POLICY, JSON.stringify({ ...stored, capture }))
  }

  describe(p: ProviderInfo): ProviderInfo {
    const uses = providerUses(p.provider)
    return { ...p, ...uses, ...(uses.judge && this.refused(p) ? { refused: true as const } : {}) }
  }

  async keyChanged(provider: string): Promise<void> {
    if (!providerUses(provider).judge) return
    deleteSetting(this.sql, refusedKey(provider))
    await this.armCapture()
  }
}
