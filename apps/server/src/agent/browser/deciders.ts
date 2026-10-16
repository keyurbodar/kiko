import type { AuthResult, ClassifierQuestion, Models } from "@earendil-works/pi-ai"
import type { ModelRef } from "@earendil-works/pi-durable"
import { escalating } from "@kiko/browser/decide/escalate"
import { jevDecider } from "@kiko/browser/decide/jev"
import { modelDecider } from "@kiko/browser/decide/model"
import type { JevPort, ModelPort } from "@kiko/browser/decide/ports"
import type { Decider } from "@kiko/browser/decide/types"
import { jevRanker, lexicalRanker, type Ranker } from "@kiko/browser/plan/rank"
import { count } from "../../lib/dev-guard"
import type { DeciderChoice } from "./tools"

/**
 * A decision is one option key, but Muse Spark thinks about 140 tokens even at minimal, and at 256 about 1 answer
 * in 10 hit the cap with no text. At 1024 none did (0/43) and decide time did not move.
 */
const DECIDER_MAX_TOKENS = 1024

/** The agent's own model, at its lowest reasoning, through the run's own `Models` (and so through egress). */
export function modelPort(models: Models, ref: ModelRef, sessionId: string): ModelPort {
  return {
    async complete(system, user, signal) {
      const model = models.getModel(ref.provider, ref.modelId)
      if (!model) throw new Error(`unknown model ${ref.provider}/${ref.modelId}`)
      count("browser.decider.calls")
      const reply = await models.completeSimple(
        model,
        { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] },
        { reasoning: "minimal", maxTokens: DECIDER_MAX_TOKENS, signal, sessionId, headers: { "x-opencode-session": sessionId } },
      )
      if (reply.stopReason === "error") throw new Error(`the decider model failed: ${reply.errorMessage ?? "error"}`.slice(0, 200))
      return reply.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("")
    },
  }
}

export type JevKey = { provider: string; auth: AuthResult }

/**
 * Jev through pi-ai `classify`, which answers a Choice with per-option probabilities and a confidence,
 * so no direct System One call is needed. Every request goes out through `egress`.
 */
export function jevPort(models: Models, key: JevKey, egress: typeof fetch | undefined): JevPort {
  const classifier = () => {
    const model = models.getModelsOfType("classifier", key.provider)[0]
    if (!model) throw new Error(`no classifier model for ${key.provider}`)
    return model
  }
  const ask = async (state: Record<string, unknown>, questions: Record<string, ClassifierQuestion>, signal: AbortSignal) => {
    count("browser.jev.calls")
    const result = await models.classify(classifier(), { state: state as never, questions }, { signal, ...(egress ? { fetch: egress } : {}) })
    count("browser.jev.input", result.usage?.input ?? 0)
    count("browser.jev.output", result.usage?.output ?? 0)
    if (result.stopReason !== "stop") throw new Error(`jev failed: ${result.stopReason} ${/\((\d{3})\)/.exec(result.errorMessage ?? "")?.[1] ?? ""}`.trim())
    return result.answers
  }
  return {
    async choose(req, signal) {
      const criteria = Object.fromEntries(req.options.map((o) => [o.key, o.text]))
      const answers = await ask(req.state, { step: { type: "choice", instructions: req.instructions, criteria } }, signal)
      const answer = answers.step
      if (answer?.type !== "choice") throw new Error("jev gave no choice")
      return { key: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence }
    },
    async noul(req, signal) {
      const questions = Object.fromEntries(req.questions.map((q) => [q.key, { type: "bool" as const, instructions: q.instructions, criteria: { true: "yes", false: "no" } }]))
      const answers = await ask(req.state, questions, signal)
      return Object.fromEntries(req.questions.map((q) => {
        const a = answers[q.key]
        return [q.key, a?.type === "bool" ? a.probability : 0]
      }))
    },
  }
}

export type Picked = { decider: Decider; ranker: Ranker }

/** A judge that fails is not the browser failing. The agent's own model and the lexical ranker take over, unless the call was stopped. */
function fallingBack(primary: Decider, backup: Decider): Decider {
  return {
    name: primary.name,
    async decide(input, signal) {
      try {
        return await primary.decide(input, signal)
      } catch (e) {
        if (signal.aborted) throw e
        count("browser.jev.fallback")
        return backup.decide(input, signal)
      }
    },
  }
}

function rankingWithFallback(primary: Ranker, backup: Ranker): Ranker {
  return {
    async rank(find, passages, signal) {
      try {
        return await primary.rank(find, passages, signal)
      } catch (e) {
        if (signal.aborted) throw e
        count("browser.jev.fallback")
        return backup.rank(find, passages, signal)
      }
    },
  }
}

/** Jev when the user has a TypeSafe key, with the agent's own model for any step Jev is unsure of or cannot answer. Both use the same loop. */
export function pickDecider(model: ModelPort, jev: JevPort | null): Picked {
  const own = modelDecider(model)
  if (!jev) return { decider: own, ranker: lexicalRanker }
  return { decider: fallingBack(escalating(jevDecider(jev), own), own), ranker: rankingWithFallback(jevRanker(jev), lexicalRanker) }
}

/** The browser needs no judge key. Finding one is best effort: an error while looking is the same as having none. */
export async function chooseDecider(model: ModelPort, judge: () => Promise<JevPort | null>): Promise<DeciderChoice> {
  const jev = await judge().catch(() => null)
  return { name: jev ? "jev" : "model", ...pickDecider(model, jev) }
}
