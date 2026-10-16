import { Schema } from "effect"


export const LoopKind = Schema.Literals(["goal", "intention", "commitment", "waiting", "project"])
export const LoopStatus = Schema.Literals(["open", "done", "dropped", "snoozed"])

export const LoopRow = Schema.Struct({
	id: Schema.Number,
	kind: LoopKind,
	owner: Schema.String,
	room: Schema.String,
	due: Schema.NullOr(Schema.String),
	status: LoopStatus,
	text: Schema.String,
	snoozedUntil: Schema.NullOr(Schema.Number),
})
export type LoopRow = typeof LoopRow.Type

export const LoopList = Schema.Struct({ loops: Schema.Array(LoopRow) })

export const LoopAction = Schema.Union([
	Schema.Struct({ action: Schema.Literals(["done", "drop"]) }),
	Schema.Struct({ action: Schema.Literal("snooze"), until: Schema.Number }),
])
export type LoopAction = typeof LoopAction.Type

export const INITIATIVE_LEVELS = ["off", "chat", "digest", "active"] as const
export const CAPTURE_MODES = ["auto", "off"] as const
export const UserSettings = Schema.Struct({
	initiative: Schema.Literals(INITIATIVE_LEVELS),
	capture: Schema.Literals(CAPTURE_MODES),
	timezone: Schema.optionalKey(Schema.String),
	/** The owner finished or skipped first run, on any device. */
	onboarded: Schema.optionalKey(Schema.Boolean),
})
export type UserSettings = typeof UserSettings.Type
export const UserSettingsPatch = Schema.Struct({
	initiative: Schema.optionalKey(Schema.Literals(INITIATIVE_LEVELS)),
	capture: Schema.optionalKey(Schema.Literals(CAPTURE_MODES)),
	timezone: Schema.optionalKey(Schema.String),
	onboarded: Schema.optionalKey(Schema.Literal(true)),
})
export type UserSettingsPatch = typeof UserSettingsPatch.Type
