/**
 * Input and output shapes of the attention module. They mirror the open-loops store and the signal
 * bus that other work owns (initiative plan, revision 1). Integration maps those types onto these.
 */

/** A loop kind, or `task` for a workspace task read through the same shape. */
export type Kind = "goal" | "intention" | "commitment" | "waiting" | "project" | "task"

/** One thing that might deserve attention: an open loop or a workspace task. */
export type Candidate = {
  /** Stable id: the loop key or `task:<id>`. */
  id: string
  kind: Kind
  certainty: "explicit" | "tentative"
  /** `human`, or the slug of the agent that owns it (its own promise). */
  owner: "human" | string
  /** The room it came from. Cross-room loops name the home chat. */
  room: string
  /** Epoch ms. */
  due?: number
  mentions: number
  /** Epoch ms of the last time anyone mentioned it. */
  lastSeen: number
  /** How many times it was nudged before. */
  surfaced: number
  /** Epoch ms of the last nudge. */
  lastSurfaced?: number
  /** How many of those nudges were ignored. */
  ignored: number
  tainted: boolean
  /** A prep run could help before its moment (the user granted "prepare ahead" for what it needs). */
  preparable?: boolean
}

/**
 * The signals attention reads from the bus. The bus kinds come from RoomDO; `dismiss` is the
 * human dismissing a nudge or saying "stop", set by whatever understood it (the UI, the lead's
 * `loop` tool, a judge), never by pattern matching here.
 */
export type Signal =
  | { kind: "burst"; id: string; room: string; at: number; from: "human" }
  | { kind: "agent_final"; id: string; room: string; at: number; slug: string }
  | { kind: "task"; id: string; room: string; at: number; by: "human" | string }
  | { kind: "file" | "routine_result" | "reminder_fired" | "watch_change"; id: string; room: string; at: number }
  | { kind: "dismiss"; id: string; room: string; at: number; nudge?: string; loop?: string }

/** The initiative setting. `chat` allows only briefs. `digest` allows at most one nudge a pass. */
export type Level = "off" | "chat" | "digest" | "active"

export type Target = { room: string; slug: string }

/**
 * Why a candidate got its verdict. `dismissed` asks the caller to drop the loop in the store; every
 * other `drop` only leaves it out of this pass.
 */
export type Reason =
  | "off"
  | "dismissed"
  | "resting"
  | "moment"
  | "cold"
  | "away"
  | "budget"
  | "typing"
  | "tentative"
  | "appetite"
  | "quiet"
  | "room_taken"
  | "allowance"
  | "worth"
  | "no_lead"

export type Verdict =
  | { id: string; verdict: "drop"; reason: Reason }
  | { id: string; verdict: "rest"; until: number; reason: Reason }
  | { id: string; verdict: "brief"; score: number; reason?: Reason }
  | { id: string; verdict: "nudge" | "prepare" | "ask_lead"; score: number; worth: number; target: Target }
