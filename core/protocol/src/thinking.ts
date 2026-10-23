export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export const THINKING_LABELS: Readonly<Record<ThinkingLevel, string>> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

export function defaultThinking(supported: readonly ThinkingLevel[]): ThinkingLevel {
  return supported.find((level) => level !== "off") ?? "off"
}

const ORDER: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

export function clampThinking(supported: readonly ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
  if (supported.includes(wanted)) return wanted
  const at = ORDER.indexOf(wanted)
  return (
    ORDER.slice(at).find((l) => supported.includes(l)) ??
    ORDER.slice(0, at)
      .toReversed()
      .find((l) => supported.includes(l)) ??
    supported[0] ??
    "off"
  )
}
