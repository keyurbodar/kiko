// Where a one-click update is, as the backend reports it. Pure, so the table is tested in update.test.ts.

import type { UpdateStage, UserToClient } from "@kiko/protocol"

export type UpdateProgress = { stage: UpdateStage; error?: string } | null

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
