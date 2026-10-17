// How a working agent's typing dots move, and what its line says. The room reports a few plain
// words per tool call (`describeCall` in the server's presence extension); this table turns them
// into one motion and one caption. A run with no report is writing its reply, and writing is
// kat's wave.

export type Motion = "wave" | "scan" | "hop" | "orbit"

const RULES: readonly (readonly [RegExp, Motion])[] = [
  [/^(reading|looking through)\b/, "scan"],
  [/^(editing|setting up agents)\b/, "hop"],
]

export function motionOf(doing: string | undefined): Motion {
  if (!doing || doing === "writing a reply") return "wave"
  return RULES.find(([pattern]) => pattern.test(doing))?.[1] ?? "orbit"
}

/** How long one activity goes before its line says how long it has taken. */
export const ELAPSED_AFTER_MS = 30_000

/** The activity's line: what the agent is doing, then for how long. Writing a reply says "Thinking". */
export function captionOf(doing: string | undefined, elapsedMs: number): string {
  const act = doing && doing !== "writing a reply" ? doing.charAt(0).toUpperCase() + doing.slice(1) : "Thinking"
  if (elapsedMs < ELAPSED_AFTER_MS) return act
  const s = Math.floor(elapsedMs / 1000)
  const took = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  return `${act} for ${took}.`
}
