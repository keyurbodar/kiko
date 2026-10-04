// What a working agent is shown doing. The room reports a few plain words per tool call
// (`describeCall` in the server's presence extension); this table turns them into one of the
// pixel bird's acts. A run with no report is writing its reply.

export type Act = "write" | "read" | "browse" | "build" | "tool" | "helper" | "remind" | "hatch"

const RULES: readonly (readonly [RegExp, Act])[] = [
  [/^reading a web page/, "browse"],
  [/^(reading|looking through)\b/, "read"],
  [/^editing\b/, "build"],
  [/^working with a helper/, "helper"],
  [/^handling a reminder/, "remind"],
  [/^setting up agents/, "hatch"],
]

export function actOf(doing: string | undefined): Act {
  if (!doing || doing === "writing a reply") return "write"
  return RULES.find(([pattern]) => pattern.test(doing))?.[1] ?? "tool"
}
