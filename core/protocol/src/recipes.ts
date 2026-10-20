import type { RoomId } from "./ids"
import type { Trigger } from "./routines"

export type RecipeTone = "amber" | "violet" | "green" | "teal" | "pink" | "blue" | "red" | "orange" | "slate"

export type RecipeApp = { name: string; slug: string; connected: boolean | null }

export type RecipeCard = {
  slug: string
  title: string
  description: string
  when: string
  apps: readonly RecipeApp[]
  setup: readonly string[]
  agent: { name: string; handle: string }
  custom: boolean
  tags: readonly string[]
  icon: string
  glyph: string
  tone: RecipeTone
}

export type RecipeRoutine = { id: string; name: string; trigger: Trigger; tz: string; status: "active" | "paused"; dueUtc: number }

export type RecipeInstall = { installId: string; slug: string; roomId: RoomId; agent: string; at: number; routines: readonly RecipeRoutine[] }

export type InstallRecipe = { installId: string; slug: string } & ({ roomId: RoomId; agent: string } | { own: true })

export type RecipeNeedsConnect = { state: "needs_connect"; links: readonly { app: string; url: string }[]; reason?: string }

export type RecipeList = { cards: readonly RecipeCard[]; installs: readonly RecipeInstall[]; broken: readonly string[] }
