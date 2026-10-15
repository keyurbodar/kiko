import type { RecipeCard } from "@kiko/protocol"
import "./recipe.css"

/** A recipe's round icon: its glyph on a tint of its tone. The glyph is a build constant, so innerHTML is safe. */
export function RecipeIcon(props: { recipe: Pick<RecipeCard, "glyph" | "tone">; size: number }) {
  return (
    <span
      class="recipe-icon"
      style={{ width: `${props.size}px`, height: `${props.size}px`, "--recipe-tone": `var(--recipe-${props.recipe.tone})` }}
      aria-hidden="true"
      data-component="recipe-icon"
    >
      <svg viewBox="0 0 256 256" fill="currentColor" innerHTML={props.recipe.glyph} />
    </span>
  )
}
