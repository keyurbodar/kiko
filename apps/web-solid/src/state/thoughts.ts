import { createSignal } from "solid-js"

export type ThoughtPart = { text: string; startedAt: number; spentMs: number; since?: number }

export type Thought = {
  runId: string
  slug: string
  parts: readonly ThoughtPart[]
  openSince: number | null
  after: number
  over: boolean
}

export type ThinkingSignal = {
  slug: string
  runId: string
  part: number
  offset: number
  text: string
  startedAt: number
  done: boolean
}

const KEPT = 20

const empty = (startedAt: number): ThoughtPart => ({ text: "", startedAt, spentMs: 0 })

export function heardThought(
  previous: Thought | undefined,
  signal: ThinkingSignal,
  now: number,
  after: number,
): Thought {
  const base: Thought =
    previous && previous.runId === signal.runId
      ? previous
      : { runId: signal.runId, slug: signal.slug, parts: [], openSince: null, after, over: false }
  const parts = [...base.parts]
  while (parts.length < signal.part) parts.push(empty(signal.startedAt))
  const fresh = parts[signal.part] === undefined
  const current = parts[signal.part] ?? empty(signal.startedAt)
  const appended = signal.offset === current.text.length ? current.text + signal.text : current.text
  const text = signal.done ? signal.text : appended
  const since = current.since ?? now
  parts[signal.part] = {
    text,
    startedAt: signal.startedAt || current.startedAt,
    since,
    spentMs: signal.done ? Math.max(0, now - since) : current.spentMs,
  }
  const openSince = fresh ? now : (base.openSince ?? now)
  return signal.done ? { ...base, parts, openSince: null } : { ...base, parts, openSince, over: false }
}

export const partMs = (part: ThoughtPart, now: number, over: boolean): number =>
  part.spentMs || (over ? 0 : Math.max(0, now - (part.since ?? part.startedAt)))

export const thoughtMs = (thought: Thought, now: number): number =>
  thought.parts.reduce((total, part) => total + partMs(part, now, thought.over), 0)

export const endedThought = (thought: Thought, now: number): Thought => ({
  ...thought,
  parts: thought.parts.map((part) =>
    part.spentMs ? part : { ...part, spentMs: Math.max(0, now - (part.since ?? part.startedAt)) },
  ),
  openSince: null,
  over: true,
})

export const thoughtText = (thought: Thought): string =>
  thought.parts
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")

export const filledParts = (thought: Thought): readonly ThoughtPart[] =>
  thought.parts.filter((part) => part.text.trim() !== "")

export function restoredThought(
  slug: string,
  runId: string,
  parts: readonly { part: number; text: string; startedAt: number; spentMs: number }[],
): Thought {
  const filled: ThoughtPart[] = []
  for (const part of [...parts].sort((a, b) => a.part - b.part)) {
    while (filled.length < part.part) filled.push(empty(part.startedAt))
    filled.push({ text: part.text, startedAt: part.startedAt, spentMs: part.spentMs })
  }
  return { runId, slug, parts: filled, openSince: null, after: 0, over: true }
}

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

export const finishedThoughts = (
  all: Readonly<Record<string, readonly Thought[]>>,
): Readonly<Record<string, readonly Thought[]>> =>
  Object.fromEntries(
    Object.entries(all)
      .map(([slug, list]) => [slug, list.filter((thought) => thought.over)] as const)
      .filter(([, list]) => list.length > 0),
  )

function restoredThoughts(
  saved: Readonly<Record<string, readonly Thought[]>>,
  current: Readonly<Record<string, readonly Thought[]>>,
): Readonly<Record<string, readonly Thought[]>> {
  const out: Record<string, readonly Thought[]> = { ...current }
  for (const [slug, list] of Object.entries(saved)) {
    const heard = current[slug] ?? []
    const known = new Set(heard.map((thought) => thought.runId))
    out[slug] = [...list.filter((thought) => !known.has(thought.runId)), ...heard].slice(-KEPT)
  }
  return out
}

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
    restore(saved: Readonly<Record<string, readonly Thought[]>>) {
      setAll((current) => restoredThoughts(saved, current))
    },
  }
}
