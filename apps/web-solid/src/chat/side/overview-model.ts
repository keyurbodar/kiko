import type { Member } from "@kiko/protocol"

export const isGroup = (members: readonly Member[]): boolean => members.length > 1
