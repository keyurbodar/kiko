import * as Schema from "effect/Schema"
export class CliError extends Schema.TaggedError<CliError>()("CliError", {
  message: Schema.String,
}) {}
