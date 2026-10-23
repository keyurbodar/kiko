import type { FailCode } from "@kiko/computer/wire"

export type PcAgentRef = { slug: string; roomId: string; reason?: string }

export type PcCallOutcome = { ok: true; value: unknown } | { ok: false; code: FailCode; message: string }

export type PcReleased = { pcId: string; name: string; waiters: PcAgentRef[]; expired: boolean }

export type ComputerLinkResult = { ok: true } | { ok: false; error: string }
