import type { RecipeApp, RecipeCard } from "@kiko/protocol"
import { For, Show } from "solid-js"
import "./recipe.css"

const logoUrl = (app: Pick<RecipeApp, "slug">) => `https://logos.composio.dev/api/${app.slug}`

export function AppLogo(props: { app: RecipeApp; size: number; overlap?: number }) {
  return (
    <span
      class="recipe-logo"
      style={{
        width: `${props.size}px`,
        height: `${props.size}px`,
        "margin-left": props.overlap ? `-${props.overlap}px` : undefined,
      }}
      title={props.app.name}
    >
      <img src={logoUrl(props.app)} alt="" loading="lazy" draggable={false} />
    </span>
  )
}

const toneStyle = (recipe: Pick<RecipeCard, "tone">) => ({ "--recipe-tone": `var(--recipe-${recipe.tone})` })

export function RecipeIcon(props: {
  recipe: Pick<RecipeCard, "glyph" | "tone" | "apps">
  size: number
  stickers?: boolean
}) {
  const sticker = () => Math.max(16, Math.round(props.size * 0.42))
  return (
    <span
      class="recipe-icon"
      style={{ width: `${props.size}px`, height: `${props.size}px`, ...toneStyle(props.recipe) }}
      aria-hidden="true"
      data-component="recipe-icon"
    >
      <svg viewBox="0 0 256 256" fill="currentColor" innerHTML={props.recipe.glyph} />
      <Show when={props.stickers && props.recipe.apps.length}>
        <span class="recipe-stickers">
          <For each={props.recipe.apps.slice(0, 3)}>
            {(app, i) => <AppLogo app={app} size={sticker()} overlap={i() ? Math.round(sticker() * 0.3) : 0} />}
          </For>
        </span>
      </Show>
    </span>
  )
}
