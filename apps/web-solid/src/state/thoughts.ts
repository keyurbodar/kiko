import { createSignal } from "solid-js"

export type Thought = {
  runId: string
  slug: string
  parts: readonly string[]
  spentMs: number
  openSince: number | null
  after: number
  over: boolean
}

export type ThinkingSignal = { slug: string; runId: string; part: number; text: string; done: boolean }

const KEPT = 20

export function heardThought(
  previous: Thought | undefined,
  signal: ThinkingSignal,
  now: number,
  after: number,
): Thought {
  const base: Thought =
    previous && previous.runId === signal.runId
      ? previous
      : { runId: signal.runId, slug: signal.slug, parts: [], spentMs: 0, openSince: null, after, over: false }
  const parts = [...base.parts]
  while (parts.length < signal.part) parts.push("")
  parts[signal.part] = signal.text
  const since = base.openSince ?? now
  return signal.done
    ? { ...base, parts, spentMs: base.spentMs + (now - since), openSince: null }
    : { ...base, parts, openSince: since, over: false }
}

export const thoughtMs = (thought: Thought, now: number): number =>
  thought.spentMs + (thought.openSince === null ? 0 : now - thought.openSince)

export const endedThought = (thought: Thought, now: number): Thought => ({
  ...thought,
  spentMs: thoughtMs(thought, now),
  openSince: null,
  over: true,
})

export const thoughtText = (thought: Thought): string =>
  thought.parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n")

export const settledThoughts = (
  all: Readonly<Record<string, readonly Thought[]>>,
  now: number,
): Readonly<Record<string, readonly Thought[]>> =>
  Object.fromEntries(
    Object.entries(all).map(([slug, list]) => [
      slug,
      list.map((thought) => (thought.over ? thought : endedThought(thought, now))),
    ]),
  )

export function createThoughts() {
  const [all, setAll] = createSignal<Readonly<Record<string, readonly Thought[]>>>({})
  const latest = (slug: string) => all()[slug]?.at(-1)
  const replace = (slug: string, next: Thought) =>
    setAll((current) => {
      const list = current[slug] ?? []
      const kept = list.at(-1)?.runId === next.runId ? list.slice(0, -1) : list
      return { ...current, [slug]: [...kept, next].slice(-KEPT) }
    })
  return {
    all,
    latest,
    hear(signal: ThinkingSignal, after: number) {
      replace(signal.slug, heardThought(latest(signal.slug), signal, Date.now(), after))
    },
    idle(slug: string) {
      const thought = latest(slug)
      if (thought && !thought.over) replace(slug, endedThought(thought, Date.now()))
    },
    settle() {
      setAll((current) => settledThoughts(current, Date.now()))
    },
    clear: () => setAll({}),
  }
}
