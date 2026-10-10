import { answersFor, type Judge } from "@yuki/memory/judge"

// TypeSafe's System One endpoint (https://docs.typesafe.ai/api.md). The key is read on every call,
// so adding, replacing, or removing it takes effect on the next judgment with agents running.

export const TYPESAFE = "typesafe"
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"
export const TYPESAFE_MODEL = "typesafe_model"
export const TYPESAFE_REFUSED = "typesafe_refused"
const DEFAULT_MODEL = "jev-latest"

export type JevDeps = {
  key: () => Promise<string | null>
  setting: (key: string) => string | null
  putSetting: (key: string, value: string | null) => void
  count: (key: string, n?: number) => void
  fetch?: typeof fetch
}

export function typesafeJudge(deps: JevDeps, timeoutMs: number): Judge {
  return async (state, questions) => {
    try {
      const key = await deps.key()
      if (!key) return null
      const last4 = key.slice(-4)
      const refused = deps.setting(TYPESAFE_REFUSED)
      if (refused === last4) return null
      if (refused !== null) deps.putSetting(TYPESAFE_REFUSED, null)
      const res = await (deps.fetch ?? fetch)(TYPESAFE_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ state, model: deps.setting(TYPESAFE_MODEL) ?? DEFAULT_MODEL, questions }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 401 || res.status === 403) {
        deps.putSetting(TYPESAFE_REFUSED, last4)
        deps.count("jev_refused")
        return null
      }
      if (!res.ok) {
        deps.count("jev_errors")
        return null
      }
      const body = (await res.json()) as { answers?: unknown; usage?: { input_tokens?: number; output_tokens?: number } }
      const answers = answersFor(questions, body.answers)
      deps.count("jev_input", body.usage?.input_tokens ?? 0)
      deps.count("jev_output", body.usage?.output_tokens ?? 0)
      if (!answers) deps.count("jev_errors")
      return answers
    } catch {
      deps.count("jev_errors")
      return null
    }
  }
}
