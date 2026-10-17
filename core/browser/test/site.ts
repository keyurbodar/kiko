import type { Decider, Decision } from "../src/decide/types"
import type { Control, PageView, Step, StepResult, Tab } from "../src/page/types"

export const page = (key: string, controls: Partial<Control>[] = [], extra: Partial<PageView> = {}): PageView => ({
  key,
  url: `https://site.test/${key}`,
  title: key,
  text: "",
  omitted: 0,
  controls: controls.map((c, i) => ({ id: i + 1, role: "link", label: `link ${i + 1}`, ...c })),
  ...extra,
})

export type Site = {
  pages: Record<string, PageView>
  /** "page:op:id" (id omitted for scroll/back) to the next page, or a failure. */
  go: Record<string, string | { fail: Extract<StepResult, { ok: false }>["reason"] }>
}

export const stepKey = (at: string, s: Step) => `${at}:${s.op}${"id" in s ? `:${s.id}` : ""}`

export function fakeTab(site: Site, start: string, opts: { delayMs?: number } = {}) {
  let at = start
  const acted: Step[] = []
  const tab: Tab = {
    id: "t",
    read: async () => site.pages[at],
    act: async (step) => {
      acted.push(step)
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const next = site.go[stepKey(at, step)]
      if (next === undefined) return { ok: true }
      if (typeof next === "string") {
        at = next
        return { ok: true }
      }
      return { ok: false, reason: next.fail }
    },
    screenshot: async () => new Uint8Array(),
    eval: async () => ({ ok: false, error: "not scripted" }),
    extract: async () => "",
    dialog: () => null,
    answerDialog: async () => false,
    url: async () => `https://site.test/${at}`,
    title: async () => "",
    front: async () => {},
    close: async () => {},
  }
  return { tab, acted, at: () => at }
}

/** A decider that follows a script of option keys, or a function of the input. */
export function scripted(
  pick: (n: number, input: Parameters<Decider["decide"]>[0]) => { key: string; confidence?: number | null; runnersUp?: string[] },
  delayMs = 0,
): Decider & { calls: number } {
  const d = {
    name: "scripted",
    calls: 0,
    async decide(input: Parameters<Decider["decide"]>[0]): Promise<Decision> {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      const p = pick(d.calls++, input)
      const find = (k: string) => {
        const c = input.options.find((o) => o.key === k)
        if (!c) throw new Error(`no option ${k}`)
        return c
      }
      return { choice: find(p.key), confidence: p.confidence ?? null, runnersUp: (p.runnersUp ?? []).map(find) }
    },
  }
  return d
}

export const live = () => new AbortController().signal
