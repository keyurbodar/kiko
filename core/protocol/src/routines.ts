import * as Schema from "effect/Schema"
import { Short } from "./base"

export const WebhookMatch = Schema.Struct({
  path: Short(200),
  equals: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
  contains: Schema.optionalKey(Short(200)),
})
export type WebhookMatch = typeof WebhookMatch.Type

export const Trigger = Schema.Union([
  Schema.Struct({ on: Schema.Literal("time"), at: Short(64), rrule: Schema.optionalKey(Short(300)) }),
  Schema.Struct({ on: Schema.Literal("message"), contains: Schema.optionalKey(Short(200)) }),
  Schema.Struct({
    on: Schema.Literal("webhook"),
    match: Schema.optionalKey(Schema.Array(WebhookMatch).check(Schema.isMaxLength(8))),
  }),
])
export type Trigger = typeof Trigger.Type

export const RoutineRunStatus = Schema.Literals(["running", "ok", "quiet", "failed", "held", "timeout"])
export type RoutineRunStatus = typeof RoutineRunStatus.Type
