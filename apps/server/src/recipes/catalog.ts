import { BUILTIN_RECIPES } from "./catalog.gen"
import { parseRecipe, type Recipe } from "./recipe"

let parsed: Map<string, Recipe> | undefined

export const builtinRecipe = (slug: string): Recipe | undefined => (parsed ??= new Map(BUILTIN_RECIPES.map(([dir, content]) => [dir, parseRecipe(content, dir)]))).get(slug)
