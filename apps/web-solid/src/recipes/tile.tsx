import type { RecipeCard } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ClockIcon, PlusIcon } from "@kiko/ui/icons"
import { For, Show } from "solid-js"
import { AppLogo } from "./icon"
import { installStatus, localizeWhen, nextRunLabel } from "./model"
import { installsFor } from "./state"

export function RecipeTile(props: { recipe: RecipeCard; onOpen: () => void; onAdd: () => void }) {
  const installs = () => installsFor(props.recipe.slug)
  const soonest = () => {
    const times = installs().flatMap((i) => {
      const s = installStatus(i, props.recipe)
      return s.kind === "next" ? [s.at] : []
    })
    return times.length ? nextRunLabel(Math.min(...times), Date.now()) : "Paused"
  }
  const on = () => installs().length > 0
  return (
    <article
      class="tpl flex min-w-0 cursor-pointer gap-3 p-3 transition-transform active:scale-(--press-scale)"
      data-recipe={props.recipe.slug}
      data-on={on() ? "" : undefined}
    >
      <span class="tpl-tile mt-0.5">
        <svg
          class="tpl-glyph"
          viewBox="0 0 256 256"
          fill="currentColor"
          aria-hidden="true"
          innerHTML={props.recipe.glyph}
        />
        <RemixIcon class="tpl-plus" icon={PlusIcon} size={14} />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <button
          type="button"
          class="min-w-0 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:shadow-[inset_0_0_0_2px_var(--stroke-secondary)]"
          data-action="open-recipe"
          onClick={() => props.onOpen()}
        >
          <span class="type-base block truncate text-primary">{props.recipe.title}</span>
        </button>
        <span class="type-sm line-clamp-2 text-tertiary">{props.recipe.description}</span>
        <span class="type-sm mt-1 flex min-w-0 items-center gap-1.5 text-tertiary">
          <RemixIcon icon={ClockIcon} size={12} class="shrink-0 icon-tertiary" />
          <span class="truncate">
            <Show when={on()} fallback={localizeWhen(props.recipe.when)}>
              {soonest()}
            </Show>
          </span>
          <span class="flex shrink-0 items-center gap-1">
            <For each={props.recipe.apps.slice(0, 3)}>{(app) => <AppLogo app={app} size={16} />}</For>
          </span>
        </span>
      </span>
      <button
        type="button"
        class="absolute top-3.5 left-3 z-[1] size-9 cursor-pointer rounded-lg outline-none [@media(pointer:coarse)]:pointer-events-none"
        aria-label={`Add ${props.recipe.title}`}
        data-action="add-recipe"
        onClick={() => props.onAdd()}
      />
    </article>
  )
}
