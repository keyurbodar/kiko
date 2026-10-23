import * as Schema from "effect/Schema"
import { ThinkingLevel } from "./thinking"

export const ConnectMethod = Schema.Literals(["api_key", "device_code", "paste_code"])
export type ConnectMethod = typeof ConnectMethod.Type

export const CatalogModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  contextWindow: Schema.Number,
  maxTokens: Schema.Number,
  reasoning: Schema.Boolean,
  thinking: Schema.Array(ThinkingLevel),
  pricing: Schema.Struct({ input: Schema.Number, output: Schema.Number }),
})
export type CatalogModel = typeof CatalogModel.Type

export const CatalogProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  connect: Schema.Array(ConnectMethod),
  signIn: Schema.optionalKey(Schema.Struct({ method: ConnectMethod, label: Schema.String })),
  models: Schema.Array(CatalogModel),
  classifiers: Schema.Number,
})
export type CatalogProvider = typeof CatalogProvider.Type

export const Catalog = Schema.Struct({ providers: Schema.Array(CatalogProvider) })
export type Catalog = typeof Catalog.Type
