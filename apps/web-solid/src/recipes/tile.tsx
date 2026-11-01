import type { RecipeCard } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { PlusIcon } from "@kiko/ui/icons"
import { Show } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { RecipeChip } from "./chip"
import { AppLogo } from "./icon"
import { categoryTone, installStatus, localizeWhen, nextRunLabel } from "./model"
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
  const tone = () => categoryTone(props.recipe.tags)
  const tileStyle = () => {
    const found = tone()
    return found ? { "--tile-tone": `var(${found})` } : undefined
  }
  return (
    <article
      class="tpl page-card flex min-w-0 cursor-pointer gap-3 p-3 transition-transform active:scale-(--press-scale)"
      data-recipe={props.recipe.slug}
      data-on={on() ? "" : undefined}
    >
      <span class="tpl-tile mt-0.5" style={tileStyle()} data-tone={tone() ? "" : undefined}>
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
        <span class="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden" data-component="recipe-card-foot">
          <RecipeChip>
            <span class="truncate">
              <Show when={on()} fallback={localizeWhen(props.recipe.when)}>
                {soonest()}
              </Show>
            </span>
          </RecipeChip>
          <Show when={props.recipe.apps[0]}>
            {(app) => (
              <RecipeChip class="shrink-0">
                <AppLogo app={app()} size={14} />
                <span class="truncate">{app().name}</span>
              </RecipeChip>
            )}
          </Show>
        </span>
      </span>
      <button
        type="button"
        class="absolute top-3.5 left-3 z-[1] size-9 cursor-pointer rounded-lg outline-none [@media(pointer:coarse)]:pointer-events-none"
        aria-label={`Add ${props.recipe.title}`}
        data-action="add-recipe"
        onClick={() => props.onAdd()}
      />
      <span class="tpl-peek" aria-hidden="true">
        <span class="type-sm flex items-center gap-1.5 text-primary">
          <IdentityAvatar seed={props.recipe.agent.handle} size={16} />
          <span class="truncate">{props.recipe.agent.name}</span>
        </span>
        <span class="mt-2 flex items-center gap-1.5">
          <span class="tpl-peek-check on">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 14L8.5 17.5L19 6.5"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
              />
            </svg>
          </span>
          <span class="h-[5px] w-2/3 rounded-full bg-secondary" />
        </span>
        <span class="mt-1.5 flex items-center gap-1.5">
          <span class="tpl-peek-check" />
          <span class="h-[5px] w-1/2 rounded-full bg-secondary" />
        </span>
      </span>
    </article>
  )
}
