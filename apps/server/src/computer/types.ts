import type { FailCode } from "@kiko/computer/wire"

export type PcAgentRef = { slug: string; roomId: string; reason?: string }

export type PcCallOutcome =
  | { ok: true; value: unknown; opMs?: number }
  | { ok: false; code: FailCode; message: string; opMs?: number }

export type PcReleased = { pcId: string; name: string; waiters: PcAgentRef[]; expired: boolean }

export type PcTaken = { pcId: string; name: string; waiters: PcAgentRef[]; epoch: number }

export type ComputerLinkResult = { ok: true } | { ok: false; error: string }
