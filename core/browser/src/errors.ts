import * as Schema from "effect/Schema"

export class BrowserFailure extends Schema.TaggedError<BrowserFailure>()("BrowserFailure", {
  reason: Schema.Literals(["scheme", "script"]),
  message: Schema.String,
}) {}
