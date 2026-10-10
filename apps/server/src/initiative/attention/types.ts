import type { LoopKind } from "@yuki/memory/loops"
import type { UserSettings } from "@yuki/protocol"

/** A loop kind, `task` for a stalled workspace task, or `routine` for a routine that failed or paused. */
export type Kind = LoopKind | "task" | "routine"

/** One thing that might deserve attention: an open loop, a workspace task, or a routine. */
export type Candidate = {
  /** Stable id: `loop:<id>`, `task:...`, or `routine:...`. */
  id: string
  kind: Kind
  certainty: "explicit" | "tentative"
  /** `human`, or the slug of the agent that owns it (its own promise). */
  owner: string
  /** The room it came from. Cross-room loops name the home chat. */
  room: string
  due?: number
  mentions: number
  lastSeen: number
  /** Nudges that reached the human. */
  surfaced: number
  /** Nudges the human let pass, plus wakes the agent answered with [skip]. */
  ignored: number
  /** The last nudge or [skip]. */
  lastSurfaced?: number
  tainted: boolean
}

/**
 * What attention reads from the bus (`room/signals.ts`), reduced to what settles a nudge. `dismiss` is
 * a loop closed as dropped by whatever understood the human (the agent's `loop` tool, Jev, the panel).
 */
export type Signal =
  | { kind: "burst"; id: string; room: string; at: number }
  | { kind: "task"; id: string; room: string; at: number; by: string }
  | { kind: "dismiss"; id: string; room: string; at: number; loop: string }

export type Level = UserSettings["initiative"]

export type Target = { room: string; slug: string }

/** Why a candidate stays in the brief this pass. */
export type Reason = "off" | "quiet" | "cold" | "away" | "typing" | "fresh" | "tentative" | "appetite" | "worth" | "moment" | "no_lead" | "room_taken" | "allowance" | "budget"

export type Verdict =
  | { id: string; verdict: "rest"; until: number }
  | { id: string; verdict: "brief"; score: number; reason: Reason }
  | { id: string; verdict: "nudge"; score: number; worth: number; target: Target }
