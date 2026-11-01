import type { FailCode } from "@kiko/computer/wire"

export type { ComputerSummary } from "@kiko/protocol"

export type ComputerCallOutcome =
  | { ok: true; value: unknown; opMs?: number }
  | { ok: false; code: FailCode; message: string; opMs?: number }

export type ComputerLinkOutcome = { ok: true; url?: string } | { ok: false; error: string }

export type ComputerMode = "watch" | "control"
