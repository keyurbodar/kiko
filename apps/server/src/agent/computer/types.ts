import type { Caps, Display, FailCode, Holder } from "@kiko/computer/wire"

export type ComputerAgent = { slug: string; roomId: string; reason?: string }

export type ComputerSummary = {
  id: string
  name: string
  os: "macos" | "linux" | "windows"
  online: boolean
  caps: Caps
  holder: Holder
  agent?: ComputerAgent
  displays: Display[]
}

export type ComputerCallOutcome = { ok: true; value: unknown } | { ok: false; code: FailCode; message: string }

export type ComputerLinkOutcome = { ok: true; url?: string } | { ok: false; error: string }

export type ComputerMode = "watch" | "control"
