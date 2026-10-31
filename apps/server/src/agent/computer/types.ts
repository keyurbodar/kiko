import type { FailCode } from "@kiko/computer/wire"
import type { ComputerLinkResult } from "../../computer/types"

export type { ComputerSummary } from "@kiko/protocol"

export type ComputerCallOutcome = { ok: true; value: unknown } | { ok: false; code: FailCode; message: string }

export type ComputerLinkOutcome = ComputerLinkResult

export type ComputerMode = "watch" | "control"
