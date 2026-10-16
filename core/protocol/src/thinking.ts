/** A reasoning level, as pi-ai names it. Each model supports its own subset. */
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

/**
 * The level an agent starts at: the lowest the model offers, because a chat reply waits on every
 * turn. A model that supports only "off" has no other choice.
 */
export function defaultThinking(supported: readonly ThinkingLevel[]): ThinkingLevel {
	return supported.find((level) => level !== "off") ?? "off"
}

const ORDER: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

/**
 * The level a model runs at when `wanted` is not one it supports: the next level up, else the next
 * level down. Same rule as pi-ai's `clampThinkingLevel`, so the client can show the result before
 * the server answers. A test holds the two equal for every model.
 */
export function clampThinking(supported: readonly ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
	if (supported.includes(wanted)) return wanted
	const at = ORDER.indexOf(wanted)
	return ORDER.slice(at).find((l) => supported.includes(l)) ?? ORDER.slice(0, at).reverse().find((l) => supported.includes(l)) ?? supported[0] ?? "off"
}
