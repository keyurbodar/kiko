import type { Member, ThinkingLevel } from "@kiko/protocol"

const TAG = /(?:^|[^a-z0-9_@.-])@([a-z0-9-]{1,32})(?![a-z0-9-])/gi

export function answeringMember(members: readonly Member[], draft: string): Member | undefined {
  for (const match of draft.matchAll(TAG)) {
    const tagged = members.find((m) => m.slug === match[1]!.toLowerCase())
    if (tagged) return tagged
  }
  return members.find((m) => m.lead) ?? members[0]
}

export const canReason = (levels: readonly ThinkingLevel[] | undefined): boolean => !!levels?.some((level) => level !== "off")
