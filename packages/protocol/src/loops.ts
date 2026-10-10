import { Schema } from "effect"

// Architecture section 26. The human's open loops on the wire: `GET /api/loops` and `POST /api/loops/<id>`.
// Types only reach the client through the entry; the schemas are for the server and the CLI.

export const LoopKind = Schema.Literals(["goal", "intention", "commitment", "waiting", "project"])
export const LoopStatus = Schema.Literals(["open", "done", "dropped", "snoozed"])

export const LoopRow = Schema.Struct({
	id: Schema.Number,
	kind: LoopKind,
	certainty: Schema.Literals(["explicit", "tentative"]),
	owner: Schema.String,
	room: Schema.String,
	due: Schema.NullOr(Schema.String),
	status: LoopStatus,
	text: Schema.String,
	snoozedUntil: Schema.NullOr(Schema.Number),
})
export type LoopRow = typeof LoopRow.Type

export const LoopList = Schema.Struct({ loops: Schema.Array(LoopRow) })

/** One change to a loop. `until` is a time in ms since the epoch. */
export const LoopAction = Schema.Union([
	Schema.Struct({ action: Schema.Literals(["done", "drop"]) }),
	Schema.Struct({ action: Schema.Literal("snooze"), until: Schema.Number }),
])
export type LoopAction = typeof LoopAction.Type

/** Settings the human sets from the settings page (`GET` and `POST /api/settings`). */
export const INITIATIVE_LEVELS = ["off", "chat", "digest", "active"] as const
export const CAPTURE_MODES = ["auto", "always", "off"] as const
export const UserSettings = Schema.Struct({
	initiative: Schema.Literals(INITIATIVE_LEVELS),
	capture: Schema.Literals(CAPTURE_MODES),
})
export type UserSettings = typeof UserSettings.Type
export const UserSettingsPatch = Schema.Struct({
	initiative: Schema.optionalKey(Schema.Literals(INITIATIVE_LEVELS)),
	capture: Schema.optionalKey(Schema.Literals(CAPTURE_MODES)),
})
export type UserSettingsPatch = typeof UserSettingsPatch.Type
