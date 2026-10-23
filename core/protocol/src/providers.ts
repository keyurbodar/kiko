import * as Schema from "effect/Schema"
import { Count } from "./base"

export const ProviderProblem = Schema.Literals(["signed_out", "key_refused", "no_credit"])
export type ProviderProblem = typeof ProviderProblem.Type

export const ProviderInfo = Schema.Struct({
  provider: Schema.String,
  kind: Schema.Literals(["api_key", "oauth"]),
  last4: Schema.String,
  chat: Schema.optionalKey(Schema.Boolean),
  judge: Schema.optionalKey(Schema.Boolean),
  problem: Schema.optionalKey(ProviderProblem),
  problemAt: Schema.optionalKey(Count),
})
export type ProviderInfo = typeof ProviderInfo.Type
