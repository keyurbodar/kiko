import { clampThinking, type Member, type ThinkingLevel } from "@kiko/protocol"

// Same rule as the room's tag scan (server room/recipients.ts): an @ after a space or the start.
const TAG = /(?:^|[^a-z0-9_@.-])@([a-z0-9-]{1,32})(?![a-z0-9-])/gi

/** The member the draft tags first, or the lead when it tags none. This is the agent a model pick applies to. */
export function answeringMember(members: readonly Member[], draft: string): Member | undefined {
  for (const match of draft.matchAll(TAG)) {
    const tagged = members.find((m) => m.slug === match[1]!.toLowerCase())
    if (tagged) return tagged
  }
  return members.find((m) => m.lead) ?? members[0]
}

/** True when a model offers a reasoning level beyond "off". */
export const canReason = (levels: readonly ThinkingLevel[] | undefined): boolean => !!levels?.some((level) => level !== "off")

/** The level an agent keeps when it moves to a model with these levels. */
export function levelFor(levels: readonly ThinkingLevel[], current: ThinkingLevel | undefined): ThinkingLevel | undefined {
  return current ? clampThinking(levels, current) : undefined
}
