import type { RecipeApp, RecipeCard } from "@kiko/protocol"
import { For, Show } from "solid-js"
import "./recipe.css"

const logoUrl = (app: RecipeApp) => `https://logos.composio.dev/api/${app.slug}`

/** One app's logo on a white disc, the way it looks in the app's own icon. */
export function AppLogo(props: { app: RecipeApp; size: number; overlap?: number }) {
  return (
    <span class="recipe-logo" style={{ width: `${props.size}px`, height: `${props.size}px`, "margin-left": props.overlap ? `-${props.overlap}px` : undefined }} title={props.app.name}>
      <img src={logoUrl(props.app)} alt="" loading="lazy" draggable={false} />
    </span>
  )
}

/** The CSS variable that carries a recipe's tone, set on any element whose children tint by it. */
export const toneStyle = (recipe: Pick<RecipeCard, "tone">) => ({ "--recipe-tone": `var(--recipe-${recipe.tone})` })

/** The recipe's glyph drawn large and faint in a card's corner, so each card carries its recipe's mark. */
export function RecipeWatermark(props: { recipe: Pick<RecipeCard, "glyph"> }) {
  return <svg class="recipe-watermark" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" innerHTML={props.recipe.glyph} />
}

/**
 * A recipe's icon: its glyph on a tint of its tone, in an app icon's rounded square. With `stickers`, the logos of the apps it
 * uses sit on its lower edge. The glyph is a build constant, so innerHTML is safe.
 */
export function RecipeIcon(props: { recipe: Pick<RecipeCard, "glyph" | "tone" | "apps">; size: number; stickers?: boolean }) {
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
          <For each={props.recipe.apps.slice(0, 3)}>{(app, i) => <AppLogo app={app} size={sticker()} overlap={i() ? Math.round(sticker() * 0.3) : 0} />}</For>
        </span>
      </Show>
    </span>
  )
}
