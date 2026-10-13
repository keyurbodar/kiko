import type { AgentSlug, RoomId } from "@kiko/protocol"

export type Home = { userId: string; roomId: RoomId }

export type AgentHome = Home & { slug: AgentSlug; role?: string; lead?: boolean; private?: boolean }
