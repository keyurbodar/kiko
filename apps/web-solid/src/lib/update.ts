// Where a one-click update is, as the backend reports it. Pure, so the table is tested in update.test.ts.

import type { UpdateStage, UserToClient } from "@kiko/protocol"
import { clientBehind, type Skew } from "./version-skew"

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
	| { kind: "update"; blocked: boolean }

/**
 * A running update wins, then a failure. A newer release on the front door and an older backend are the
 * same one click: the update installs the newest release, then the tab reloads into it.
 */
export function pillView(skew: Skew | undefined, clientIsBehind: boolean, progress: UpdateProgress): PillView {
	const text = stageText(progress)
	if (text) return { kind: "busy", text }
	if (progress?.stage === "failed") return { kind: "failed", error: progress.error ?? "The update failed. Try again." }
	if (skew === "blocked") return { kind: "update", blocked: true }
	if (clientIsBehind || skew === "update") return { kind: "update", blocked: false }
	return { kind: "none" }
}

/** The release an update installs: the front door's newest when it is ahead of this tab, else this tab's own. */
export const updateTarget = (app: string, latest: string | undefined): string => (clientBehind(app, latest) ? (latest as string) : app)

/** After "restarting", the backend is asked this often until it answers with the new version. */
export const RESTART_POLL_MS = 2_000
/** Longer than any rollout seen. Past it the update is reported, not waited on for ever. */
export const RESTART_LIMIT_MS = 180_000
export const RESTART_ERROR = "Kiko was updated but has not restarted yet. Wait a minute, then try again."

/** True when the backend answers with the target release or a newer one. */
export const landed = (target: string, backend: string | undefined): boolean => backend !== undefined && !clientBehind(backend, target)

export const LATEST_POLL_MS = 5 * 60_000
