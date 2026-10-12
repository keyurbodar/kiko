import type { LoopKind } from "@yuki/memory/loops"
import type { UserSettings } from "@yuki/protocol"

export type Kind = LoopKind | "task" | "routine"

export type Candidate = {
  id: string
  kind: Kind
  certainty: "explicit" | "tentative"
  owner: string
  room: string
  due?: number
  lastSeen: number
  surfaced: number
  ignored: number
  lastSurfaced?: number
}

export type Signal =
  | { kind: "burst"; id: string; room: string; at: number }
  | { kind: "answer"; id: string; room: string; at: number; loop: string }
  | { kind: "dismiss"; id: string; room: string; at: number; loop: string }

export type Level = UserSettings["initiative"]

export type Target = { room: string; slug: string }

export type Reason = "off" | "quiet" | "cold" | "away" | "typing" | "fresh" | "tentative" | "appetite" | "worth" | "moment" | "no_lead" | "room_taken" | "allowance" | "budget"

export type Verdict =
  | { id: string; verdict: "rest"; until: number }
  | { id: string; verdict: "brief"; score: number; reason: Reason }
  | { id: string; verdict: "nudge"; score: number; worth: number; target: Target }
