import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { percentile } from "./ledger"
import type { ChatMessage, ChatPart, ModelClient, ModelReply, ModelUsage, RawToolCall } from "./model"
import type { Background, Condition, Contender, Image, ModelSpec, Task, ToolResult, ToolSpec, Verdict } from "./types"

const SYSTEM_PROMPT = [
  "You are operating a computer for its owner.",
  "Finish the task you are given. Work in the working directory; relative paths resolve there.",
  "Use the tools you have. Check the result of your work before you finish.",
  "When the task is finished, reply with DONE and nothing else.",
  "If you cannot finish, say what blocked you.",
].join("\n")

export const SYSTEM_PROMPT_SHA = createHash("sha256").update(SYSTEM_PROMPT).digest("hex")

const NUDGE = "Keep going. Reply with DONE when the task is finished."
const DONE = /DONE\s*[.!]?$/i
const TOOL_MARKUP = /<tool_call>/gi
const TOOL_JSON = /"arguments"\s*:/i

export type Outcome = "done" | "turns" | "timeout" | "model_error" | "tool_crash" | "setup_error"

export interface TrajectoryRequest {
  readonly at: string
  readonly model: string
  readonly tools: readonly string[]
  readonly messages: readonly ChatMessage[]
  readonly latency_ms: number
  readonly usage: ModelUsage
  readonly finish_reason: string | null
  readonly content: string
  readonly reasoning: string
  readonly tool_calls: readonly RawToolCall[]
  readonly error?: string
}

export interface TrajectoryTool {
  readonly at: string
  readonly name: string
  readonly args: unknown
  readonly text: string
  readonly images: readonly string[]
  readonly is_error: boolean
  readonly ms: number
}

export interface Trajectory {
  readonly run_id: string
  readonly trial_id: string
  readonly task: string
  readonly track: string
  readonly contender: string
  readonly contender_version: string
  readonly model: string
  readonly effort?: string
  readonly condition: Condition
  readonly seed: number
  readonly rep: number
  readonly system_prompt: string
  readonly system_prompt_sha: string
  readonly started_at: string
  readonly ended_at: string
  readonly wall_ms: number
  readonly outcome: Outcome
  readonly text_tool_calls: number
  readonly requests: readonly TrajectoryRequest[]
  readonly tools: readonly TrajectoryTool[]
  readonly error?: string
}

export interface LoopInput {
  readonly task: Task
  readonly contender: Contender
  readonly model: ModelSpec
  readonly client: ModelClient
  readonly runId: string
  readonly trialId: string
  readonly trajectoryDir: string
  readonly condition: Condition
  readonly seed: number
  readonly rep: number
  readonly now?: () => number
}

export interface LoopResult {
  readonly outcome: Outcome
  readonly error?: string
  readonly turns: number
  readonly toolCalls: number
  readonly toolErrors: number
  readonly usage: ModelUsage
  readonly wallMs: number
  readonly modelMs: number
  readonly toolMs: number
  readonly toolP50Ms: number
  readonly toolP95Ms: number
  readonly bytesToModel: number
  readonly imagesSent: number
  readonly imagesDropped: number
  readonly trajectory: Trajectory
}

const emptyUsage: ModelUsage = { prompt: 0, cached: 0, completion: 0, reasoning: 0, cost: 0, listCost: 0 }

const addUsage = (left: ModelUsage, right: ModelUsage): ModelUsage => ({
  prompt: left.prompt + right.prompt,
  cached: left.cached + right.cached,
  completion: left.completion + right.completion,
  reasoning: left.reasoning + right.reasoning,
  cost: left.cost + right.cost,
  listCost: left.listCost + right.listCost,
})

const redact = (messages: readonly ChatMessage[]): ChatMessage[] =>
  messages.map((message) => {
    if (message.role !== "tool" || typeof message.content === "string") return message
    const content = message.content.map((part): ChatPart =>
      part.type === "image_url" ? { type: "text", text: "[image saved beside this trajectory]" } : part,
    )
    return { ...message, content }
  })

function countTextToolCalls(content: string, known: readonly string[]): number {
  const markup = content.match(TOOL_MARKUP)?.length ?? 0
  if (markup > 0) return markup
  const named = known.some((name) => content.includes(`"name": "${name}"`) || content.includes(`"name":"${name}"`))
  return named && TOOL_JSON.test(content) ? 1 : 0
}

const parseArgs = (raw: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const extensionOf = (mime: Image["mime"]): string => (mime === "image/png" ? "png" : "jpg")

async function saveImages(dir: string, name: string, images: readonly Image[]): Promise<string[]> {
  const saved: string[] = []
  for (const [index, image] of images.entries()) {
    const file = `${name}-${index + 1}.${extensionOf(image.mime)}`
    await writeFile(join(dir, file), Buffer.from(image.base64, "base64"))
    saved.push(file)
  }
  return saved
}

function toolMessage(call: RawToolCall, text: string, images: readonly Image[], vision: boolean): ChatMessage {
  const parts: ChatPart[] = [{ type: "text", text }]
  if (vision) {
    for (const image of images)
      parts.push({ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.base64}` } })
  }
  return { role: "tool", tool_call_id: call.id, content: parts }
}

const allZero = (background: Background): boolean =>
  background.focusSteals === 0 &&
  background.pointerMoves === 0 &&
  background.keysSwallowed === 0 &&
  background.windowsRaised === 0

const perceptionTools = new Set([
  "desktop_list_windows",
  "desktop_get_window_state",
  "desktop_zoom",
  "browser_look",
  "browser_read",
])

export function classifyFailure(result: LoopResult, verdict: Verdict, background: Background): string {
  if (!allZero(background)) return "background"
  if (verdict.pass) return ""
  if (result.outcome === "model_error") return "model"
  if (result.outcome === "setup_error" || result.outcome === "tool_crash") return "environment"
  if (result.outcome === "timeout") return result.turns > 0 ? "model" : "environment"
  if (result.trajectory.text_tool_calls > 0) return "model"
  if (result.turns === 0 || result.toolCalls === 0) return "planning"
  if (result.toolErrors > 0) return "delivery"
  if (result.trajectory.tools.some((tool) => perceptionTools.has(tool.name))) return "perception"
  return "targeting"
}

type Ask =
  | { readonly ok: true; readonly reply: ModelReply }
  | {
      readonly ok: false
      readonly outcome: Outcome
      readonly error: string
    }

async function ask(
  input: LoopInput,
  messages: readonly ChatMessage[],
  tools: readonly ToolSpec[],
  known: readonly string[],
  controller: AbortController,
  requests: TrajectoryRequest[],
): Promise<Ask> {
  try {
    const reply = await input.client.chat({
      model: input.model.id,
      messages,
      tools,
      session: `kb-${input.runId}-${input.trialId}`,
      ...(input.model.effort ? { effort: input.model.effort } : {}),
      signal: controller.signal,
    })
    return { ok: true, reply }
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught)
    requests.push({
      at: new Date().toISOString(),
      model: input.model.id,
      tools: known,
      messages: redact(messages),
      latency_ms: 0,
      usage: emptyUsage,
      finish_reason: null,
      content: "",
      reasoning: "",
      tool_calls: [],
      error,
    })
    return { ok: false, outcome: controller.signal.aborted ? "timeout" : "model_error", error }
  }
}

function limitReached(
  turns: number,
  limits: { readonly turns: number; readonly seconds: number },
  elapsed: number,
  deadlineHit: boolean,
): Outcome | undefined {
  if (turns >= limits.turns) return "turns"
  if (deadlineHit || elapsed >= limits.seconds * 1000) return "timeout"
  return undefined
}

export async function runLoop(input: LoopInput): Promise<LoopResult> {
  const clock = input.now ?? (() => performance.now())
  const started = clock()
  const startedAt = new Date().toISOString()
  const tools = input.contender.tools()
  const known = tools.map((tool) => tool.name)
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input.task.prompt },
  ]
  const requests: TrajectoryRequest[] = []
  const toolRecords: TrajectoryTool[] = []
  const durations: number[] = []
  const controller = new AbortController()
  let deadlineHit = false
  const wallBudget = input.task.limits.seconds * 1000
  const timer = setTimeout(() => {
    deadlineHit = true
    controller.abort()
  }, wallBudget)

  let usage = emptyUsage
  let modelMs = 0
  let toolMs = 0
  let bytesToModel = 0
  let imagesSent = 0
  let imagesDropped = 0
  let turns = 0
  let toolCalls = 0
  let toolErrors = 0
  let textToolCalls = 0
  let stop: Outcome | undefined
  let error: string | undefined

  try {
    for (;;) {
      const limit = limitReached(turns, input.task.limits, clock() - started, deadlineHit)
      if (limit) {
        stop = limit
        break
      }
      bytesToModel += Buffer.byteLength(JSON.stringify({ messages, tools }))
      const asked = await ask(input, messages, tools, known, controller, requests)
      if (!asked.ok) {
        stop = asked.outcome
        error = asked.error
        break
      }
      const reply = asked.reply
      turns++
      modelMs += reply.latencyMs
      usage = addUsage(usage, reply.usage)
      requests.push({
        at: new Date().toISOString(),
        model: input.model.id,
        tools: known,
        messages: redact(messages),
        latency_ms: Math.round(reply.latencyMs),
        usage: reply.usage,
        finish_reason: reply.finishReason,
        content: reply.content,
        reasoning: reply.reasoning,
        tool_calls: reply.toolCalls,
      })
      if (reply.toolCalls.length === 0) {
        messages.push({
          role: "assistant",
          content: reply.content,
          ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
        })
        textToolCalls += countTextToolCalls(reply.content, known)
        if (DONE.test(reply.content.trim())) {
          stop = "done"
          break
        }
        messages.push({ role: "user", content: NUDGE })
        continue
      }
      messages.push({
        role: "assistant",
        content: reply.content,
        tool_calls: reply.toolCalls,
        ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
      })
      const turn = await runTools(input, reply.toolCalls, known, messages, {
        controller,
        durations,
        records: toolRecords,
        trajectoryDir: input.trajectoryDir,
        vision: input.model.vision,
        clock,
      })
      toolCalls += turn.calls
      toolErrors += turn.errors
      toolMs += turn.ms
      imagesSent += turn.sent
      imagesDropped += turn.dropped
      if (turn.stop) {
        stop = turn.stop
        error = turn.error
        break
      }
    }
  } finally {
    clearTimeout(timer)
  }

  const outcome = stop ?? "timeout"
  const wallMs = Math.round(clock() - started)
  const trajectory: Trajectory = {
    run_id: input.runId,
    trial_id: input.trialId,
    task: input.task.id,
    track: input.task.track,
    contender: input.contender.name,
    contender_version: input.contender.version,
    model: input.model.id,
    ...(input.model.effort ? { effort: input.model.effort } : {}),
    condition: input.condition,
    seed: input.seed,
    rep: input.rep,
    system_prompt: SYSTEM_PROMPT,
    system_prompt_sha: SYSTEM_PROMPT_SHA,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    wall_ms: wallMs,
    outcome,
    text_tool_calls: textToolCalls,
    requests,
    tools: toolRecords,
    ...(error ? { error } : {}),
  }
  return {
    outcome,
    ...(error ? { error } : {}),
    turns,
    toolCalls,
    toolErrors,
    usage,
    wallMs,
    modelMs: Math.round(modelMs),
    toolMs: Math.round(toolMs),
    toolP50Ms: Math.round(percentile(durations, 0.5)),
    toolP95Ms: Math.round(percentile(durations, 0.95)),
    bytesToModel,
    imagesSent,
    imagesDropped,
    trajectory,
  }
}

interface ToolContext {
  readonly controller: AbortController
  readonly durations: number[]
  readonly records: TrajectoryTool[]
  readonly trajectoryDir: string
  readonly vision: boolean
  readonly clock: () => number
}

interface ToolsOutcome {
  readonly calls: number
  readonly errors: number
  readonly ms: number
  readonly sent: number
  readonly dropped: number
  readonly stop: Outcome | undefined
  readonly error?: string
}

async function runTools(
  input: LoopInput,
  calls: readonly RawToolCall[],
  known: readonly string[],
  messages: ChatMessage[],
  context: ToolContext,
): Promise<ToolsOutcome> {
  let errors = 0
  let ms = 0
  let sent = 0
  let dropped = 0
  let executed = 0
  await mkdir(context.trajectoryDir, { recursive: true })
  for (const call of calls) {
    executed++
    const started = context.clock()
    const parsed = parseArgs(call.function.arguments)
    let result: ToolResult
    let crashed = false
    if (!known.includes(call.function.name)) {
      result = { text: `there is no tool called ${call.function.name}`, images: [], isError: true }
    } else if (!parsed.ok) {
      result = { text: `the tool arguments were not valid JSON: ${parsed.error}`, images: [], isError: true }
    } else {
      try {
        result = await input.contender.call(call.function.name, parsed.value, context.controller.signal)
      } catch (caught) {
        crashed = true
        result = {
          text: caught instanceof Error ? caught.message : String(caught),
          images: [],
          isError: true,
        }
      }
    }
    const elapsed = context.clock() - started
    ms += elapsed
    context.durations.push(elapsed)
    if (result.isError) errors++
    const serial = context.records.length + 1
    const files = await saveImages(context.trajectoryDir, `${input.trialId}-tool-${serial}`, result.images)
    if (context.vision) sent += result.images.length
    else dropped += result.images.length
    messages.push(toolMessage(call, result.text, result.images, context.vision))
    context.records.push({
      at: new Date().toISOString(),
      name: call.function.name,
      args: parsed.ok ? parsed.value : call.function.arguments,
      text: result.text,
      images: files,
      is_error: result.isError,
      ms: Math.round(elapsed),
    })
    if (crashed) return { calls: executed, errors, ms, sent, dropped, stop: "tool_crash", error: result.text }
  }
  return { calls: executed, errors, ms, sent, dropped, stop: undefined }
}
