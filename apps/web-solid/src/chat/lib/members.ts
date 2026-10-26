import type { RosterBot } from "../../lib/types"

function arrayElementsEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function keepArray<T>(previous: readonly T[] | undefined, next: readonly T[]): readonly T[] {
  return previous && arrayElementsEqual(previous, next) ? previous : next
}

export interface RoomMember {
  readonly slug: string
  readonly name: string
  readonly lead?: boolean
}

function speakerOf(member: RoomMember): RosterBot {
  return {
    id: member.slug,
    name: member.name,
    preview: "",
    updatedAt: 0,
    presence: "idle",
    unread: 0,
    pinned: false,
    ...(member.lead ? { persona: "lead" } : {}),
  }
}

export function keepSpeakers(
  previous: ReadonlyMap<string, RosterBot> | undefined,
  members: readonly RoomMember[],
): ReadonlyMap<string, RosterBot> {
  const next = new Map<string, RosterBot>()
  for (const member of members) {
    const kept = previous?.get(member.slug)
    const fresh = speakerOf(member)
    next.set(member.slug, kept && kept.name === fresh.name && kept.persona === fresh.persona ? kept : fresh)
  }
  const same =
    previous !== undefined &&
    previous.size === next.size &&
    [...next].every(([slug, bot]) => previous.get(slug) === bot)
  return same ? previous : next
}
