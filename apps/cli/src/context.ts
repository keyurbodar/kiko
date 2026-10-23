import * as Schema from "effect/Schema"

export class CliError extends Schema.TaggedError<CliError>()("CliError", { message: Schema.String }) {}

export interface Context {
  url: string
  json: boolean
  args: string[]
  idle: number
  dev: boolean
  name?: string
  port?: string
  identity?: string
  runs: string
  tail?: string
}
