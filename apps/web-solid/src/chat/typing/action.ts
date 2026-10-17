// How a working agent's typing dots move. The room reports a few plain words per tool call
// (`describeCall` in the server's presence extension); this table turns them into one motion.
// A run with no report is writing its reply, and writing is kat's wave.

export type Motion = "wave" | "scan" | "hop" | "orbit"

const RULES: readonly (readonly [RegExp, Motion])[] = [
  [/^(reading|looking through)\b/, "scan"],
  [/^(editing|setting up agents)\b/, "hop"],
]

export function motionOf(doing: string | undefined): Motion {
  if (!doing || doing === "writing a reply") return "wave"
  return RULES.find(([pattern]) => pattern.test(doing))?.[1] ?? "orbit"
}

/** How long a run goes before its row shows how long it has been working. */
export const ELAPSED_AFTER_MS = 30_000
/** How long a run goes before its row says a slow model is the likely reason. */
export const SLOW_AFTER_MS = 120_000

/** The row's caption: what the agent is doing, then, once the run is slow, for how long. */
export function captionOf(doing: string | undefined, elapsedMs: number): string | undefined {
  const act = doing && motionOf(doing) !== "wave" ? doing.charAt(0).toUpperCase() + doing.slice(1) : undefined
  if (elapsedMs < ELAPSED_AFTER_MS) return act
  const s = Math.floor(elapsedMs / 1000)
  const took = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  const line = act ? `${act} for ${took}.` : `Working for ${took}.`
  return elapsedMs < SLOW_AFTER_MS ? line : `${line} Slow models can take a few minutes. Kiko stops a request at 5 minutes.`
}
