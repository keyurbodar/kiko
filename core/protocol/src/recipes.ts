import * as Schema from "effect/Schema"
import { Count, Id } from "./base"
import { RoomId } from "./brands"
import { Trigger } from "./routines"

export const RecipeTone = Schema.Literals([
  "amber",
  "violet",
  "green",
  "teal",
  "pink",
  "blue",
  "red",
  "orange",
  "slate",
])
export type RecipeTone = typeof RecipeTone.Type

export const RecipeApp = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  connected: Schema.NullOr(Schema.Boolean),
})
export type RecipeApp = typeof RecipeApp.Type

export const RecipeCard = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  description: Schema.String,
  when: Schema.String,
  apps: Schema.Array(RecipeApp),
  setup: Schema.Array(Schema.String),
  agent: Schema.Struct({ name: Schema.String, handle: Schema.String }),
  custom: Schema.Boolean,
  tags: Schema.Array(Schema.String),
  icon: Schema.String,
  glyph: Schema.String,
  tone: RecipeTone,
})
export type RecipeCard = typeof RecipeCard.Type

export const RecipeRoutine = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  trigger: Trigger,
  tz: Schema.String,
  status: Schema.Literals(["active", "paused"]),
  dueUtc: Schema.Number,
})
export type RecipeRoutine = typeof RecipeRoutine.Type

export const RecipeInstall = Schema.Struct({
  installId: Schema.String,
  slug: Schema.String,
  roomId: RoomId,
  agent: Schema.String,
  at: Count,
  routines: Schema.Array(RecipeRoutine),
})
export type RecipeInstall = typeof RecipeInstall.Type

export const InstallRecipe = Schema.Union([
  Schema.Struct({ installId: Id, slug: Id, roomId: RoomId, agent: Schema.String }),
  Schema.Struct({ installId: Id, slug: Id, own: Schema.Literal(true) }),
])
export type InstallRecipe = typeof InstallRecipe.Type

export const RecipeNeedsConnect = Schema.Struct({
  state: Schema.Literal("needs_connect"),
  links: Schema.Array(Schema.Struct({ app: Schema.String, url: Schema.String })),
  reason: Schema.optionalKey(Schema.String),
})
export type RecipeNeedsConnect = typeof RecipeNeedsConnect.Type

export const RecipeList = Schema.Struct({
  cards: Schema.Array(RecipeCard),
  installs: Schema.Array(RecipeInstall),
  broken: Schema.Array(Schema.String),
})
export type RecipeList = typeof RecipeList.Type
