import type { RecipeCard } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ClockIcon, PlusIcon } from "@kiko/ui/icons"
import { For, Show } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
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
      class="tpl flex min-w-0 cursor-pointer gap-4 p-3.5 active:scale-[0.995]"
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
        <RemixIcon class="tpl-plus" icon={PlusIcon} size={20} />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          class="min-w-0 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:shadow-[inset_0_0_0_2px_var(--line2)]"
          data-action="open-recipe"
          onClick={() => props.onOpen()}
        >
          <span class="type-ui block truncate font-semibold text-fg">{props.recipe.title}</span>
        </button>
        <span class="type-row line-clamp-2 text-fg3">{props.recipe.description}</span>
        <span class="type-label mt-1 flex min-w-0 items-center gap-2 text-fg4">
          <RemixIcon icon={ClockIcon} size={14} class="shrink-0" />
          <span class="truncate">
            <Show when={on()} fallback={localizeWhen(props.recipe.when)}>
              {soonest()}
            </Show>
          </span>
          <span class="flex shrink-0 items-center gap-1">
            <For each={props.recipe.apps.slice(0, 3)}>{(app) => <AppLogo app={app} size={18} />}</For>
          </span>
        </span>
      </span>
      <button
        type="button"
        class="absolute top-3.5 left-3.5 z-[1] size-10 cursor-pointer rounded-tile outline-none [@media(pointer:coarse)]:pointer-events-none"
        aria-label={`Add ${props.recipe.title}`}
        data-action="add-recipe"
        onClick={() => props.onAdd()}
      />
      <span class="tpl-peek" aria-hidden="true">
        <span class="type-label flex items-center gap-2 font-medium text-fg">
          <IdentityAvatar seed={props.recipe.agent.handle} size={16} />
          <span class="truncate">{props.recipe.agent.name}</span>
        </span>
        <span class="mt-2 block h-1.5 w-4/5 rounded-full bg-active" />
        <span class="mt-1.5 block h-1.5 w-3/5 rounded-full bg-active" />
      </span>
    </article>
  )
}
