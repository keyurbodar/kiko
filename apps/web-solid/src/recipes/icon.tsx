import type { RecipeApp, RecipeCard } from "@kiko/protocol"
import "./recipe.css"

const logoUrl = (app: Pick<RecipeApp, "slug">) => `https://logos.composio.dev/api/${app.slug}`

export function AppLogo(props: { app: RecipeApp; size: number }) {
  return (
    <span
      class="recipe-logo"
      style={{
        width: `${props.size}px`,
        height: `${props.size}px`,
      }}
      title={props.app.name}
    >
      <img src={logoUrl(props.app)} alt="" loading="lazy" draggable={false} />
    </span>
  )
}

const toneStyle = (recipe: Pick<RecipeCard, "tone">) => ({ "--recipe-tone": `var(--recipe-${recipe.tone})` })

export function RecipeIcon(props: { recipe: Pick<RecipeCard, "glyph" | "tone">; size: number }) {
  return (
    <span
      class="recipe-icon"
      style={{ width: `${props.size}px`, height: `${props.size}px`, ...toneStyle(props.recipe) }}
      aria-hidden="true"
      data-component="recipe-icon"
    >
      <svg viewBox="0 0 256 256" fill="currentColor" innerHTML={props.recipe.glyph} />
    </span>
  )
}
