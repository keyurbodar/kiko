export type Motion = "wave" | "scan" | "hop" | "orbit"

const RULES: readonly (readonly [RegExp, Motion])[] = [
  [/^(reading|looking through)\b/, "scan"],
  [/^(editing|setting up agents)\b/, "hop"],
]

export function motionOf(doing: string | undefined): Motion {
  if (!doing || doing === "writing a reply") return "wave"
  return RULES.find(([pattern]) => pattern.test(doing))?.[1] ?? "orbit"
}

export const ELAPSED_AFTER_MS = 30_000

export function captionOf(doing: string | undefined, elapsedMs: number): string {
  const act = doing && doing !== "writing a reply" ? doing.charAt(0).toUpperCase() + doing.slice(1) : "Thinking"
  if (elapsedMs < ELAPSED_AFTER_MS) return act
  const s = Math.floor(elapsedMs / 1000)
  const took = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  return `${act} for ${took}.`
}
