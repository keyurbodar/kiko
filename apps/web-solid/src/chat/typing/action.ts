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
