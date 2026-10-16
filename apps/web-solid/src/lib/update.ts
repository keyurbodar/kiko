// Where a one-click update is, as the backend reports it. Pure, so the table is tested in update.test.ts.

import type { UpdateStage, UserToClient } from "@kiko/protocol"
import type { Skew } from "./version-skew"

/** `sentAt` is set only while the client waits for the backend's first frame. */
export type UpdateProgress = { stage: UpdateStage; error?: string; sentAt?: number } | null

/** A backend from before updates ignores `update.start`, so silence this long means it cannot update itself. */
export const STALL_MS = 20_000
export const STALL_ERROR = "This backend cannot update itself. Reconnect Cloudflare to reinstall it."

export const sent = (now: number): UpdateProgress => ({ stage: "checking", sentAt: now })

/** The failed state when no frame answered `update.start` in time. Otherwise the progress as it was. */
export function checkStall(progress: UpdateProgress, now: number): UpdateProgress {
	if (progress?.sentAt === undefined || now - progress.sentAt < STALL_MS) return progress
	return { stage: "failed", error: STALL_ERROR }
}

export const STAGE_TEXT: Record<Exclude<UpdateStage, "failed">, string> = {
	checking: "Checking the release",
	authorizing: "Authorizing",
	uploading: "Uploading",
	restarting: "Restarting",
}

type StateFrame = Extract<UserToClient, { t: "update.state" }>

export function reduceUpdate(frame: StateFrame): UpdateProgress {
	return frame.stage === "failed" ? { stage: "failed", error: frame.error ?? "The update failed. Try again." } : { stage: frame.stage }
}

/** The text a stage shows. Undefined when the stage is idle or failed. */
export function stageText(progress: UpdateProgress): string | undefined {
	return progress && progress.stage !== "failed" ? STAGE_TEXT[progress.stage] : undefined
}

/** What the sidebar pill and the composer notice show. */
export type PillView =
	| { kind: "none" }
	| { kind: "busy"; text: string }
	| { kind: "failed"; error: string }
	| { kind: "reload" }
	| { kind: "update"; blocked: boolean }

/**
 * A running update wins, then a failure. A stale tab comes before the backend update, because the
 * update installs this tab's own version and would install the old one.
 */
export function pillView(skew: Skew | undefined, clientIsBehind: boolean, progress: UpdateProgress): PillView {
	const text = stageText(progress)
	if (text) return { kind: "busy", text }
	if (progress?.stage === "failed") return { kind: "failed", error: progress.error ?? "The update failed. Try again." }
	if (clientIsBehind) return { kind: "reload" }
	if (skew === "update" || skew === "blocked") return { kind: "update", blocked: skew === "blocked" }
	return { kind: "none" }
}

export const LATEST_POLL_MS = 30 * 60_000
