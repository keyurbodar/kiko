import type { RoomId } from "./ids"

/** A recipe's tile color. The client maps each to a light and a dark pair. */
export type RecipeTone = "amber" | "violet" | "green" | "teal" | "pink" | "blue" | "red" | "orange" | "slate"

/** What the gallery shows for a recipe. */
export type RecipeCard = {
  slug: string
  title: string
  description: string
  /** When it runs, in words: "Daily at 7:55", "When you ask". */
  when: string
  /** Composio toolkit names it needs, as people say them: "Gmail", "Google Calendar". */
  apps: readonly string[]
  tags: readonly string[]
  /** The Phosphor icon name, and its duotone svg body on a 256 unit grid. */
  icon: string
  glyph: string
  tone: RecipeTone
}

/** A recipe added to one agent in one chat. */
export type RecipeInstall = { installId: string; slug: string; roomId: RoomId; agent: string; at: number }

/** `own` gives the recipe a new agent with its own chat. */
export type InstallRecipe = { installId: string; slug: string } & ({ roomId: RoomId; agent: string } | { own: true })

/** The owner's recipes from /home/recipes, what is added where, and why any file did not load. */
export type RecipeList = { cards: readonly RecipeCard[]; installs: readonly RecipeInstall[]; broken: readonly string[] }
