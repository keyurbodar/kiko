import type { RecipeCard } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { PlusIcon } from "@kiko/ui/icons"
import { For, Show } from "solid-js"
import { cn } from "../lib/cn"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { RecipeIcon, RecipeWatermark, toneStyle } from "./icon"
import { installStatus, nextRunLabel } from "./model"
import { installsFor } from "./state"

export function RecipeTile(props: { recipe: RecipeCard; onOpen: () => void; onAdd: () => void }) {
  const installs = () => installsFor(props.recipe.slug)
  const agents = () => [...new Set(installs().map((i) => i.agent))]
  const soonest = () => {
    const times = installs().flatMap((i) => {
      const s = installStatus(i, props.recipe)
      return s.kind === "next" ? [s.at] : []
    })
    return times.length ? nextRunLabel(Math.min(...times), Date.now()) : "Paused"
  }
  const on = () => installs().length > 0
  const status = () => (
    <Show when={on()} fallback={<span class="truncate">{props.recipe.when}</span>}>
      <span class="truncate text-foreground/85">{soonest()}</span>
    </Show>
  )
  return (
    <article
      class={cn(
        "recipe-card flex min-w-0 flex-col gap-3 rounded-[20px] p-4 [--recipe-surface:var(--card)]",
        "@max-[519px]/recipes:flex-row @max-[519px]/recipes:items-center @max-[519px]/recipes:gap-3 @max-[519px]/recipes:rounded-[14px] @max-[519px]/recipes:px-2.5 @max-[519px]/recipes:py-2",
      )}
      style={toneStyle(props.recipe)}
      data-recipe={props.recipe.slug}
      data-on={on() ? "" : undefined}
    >
      <RecipeWatermark recipe={props.recipe} />
      <button
        type="button"
        class={cn("flex min-w-0 flex-1 cursor-pointer flex-col gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit]", "@max-[519px]/recipes:flex-row @max-[519px]/recipes:items-center")}
        data-action="open-recipe"
        onClick={() => props.onOpen()}
      >
        <span class={cn("mb-1 flex", "@max-[519px]/recipes:mb-0")}>
          <RecipeIcon recipe={props.recipe} size={48} stickers />
        </span>
        <span class="flex min-w-0 flex-col gap-1">
          <span class="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">{props.recipe.title}</span>
          <span class={cn("line-clamp-2 min-h-[2.9em] text-[13px] leading-[1.45] text-muted-foreground", "@max-[519px]/recipes:hidden")}>{props.recipe.description}</span>
          <span class={cn("hidden min-w-0 items-center text-xs text-muted-foreground", "@max-[519px]/recipes:flex")}>{status()}</span>
        </span>
      </button>
      <div class={cn("relative mt-auto flex items-center justify-between gap-2", "@max-[519px]/recipes:mt-0")}>
        <span class={cn("flex min-w-0 items-center text-xs text-muted-foreground", "@max-[519px]/recipes:hidden")}>{status()}</span>
        <span class="flex shrink-0 items-center gap-1.5">
          <Show when={on()}>
            <span class="flex" role="img" aria-label={`On for ${agents().length} ${agents().length === 1 ? "agent" : "agents"}`}>
              <For each={agents().slice(0, 3)}>{(agent, i) => <IdentityAvatar seed={agent} size={22} class={i() ? "-ml-1.5" : ""} />}</For>
            </span>
          </Show>
          <button
            type="button"
            class={cn(
              "grid shrink-0 cursor-pointer place-items-center rounded-full text-foreground",
              on() ? "size-7 text-muted-foreground hover:bg-control hover:text-foreground" : "size-[30px] bg-control hover:bg-control-strong",
            )}
            aria-label={`Add ${props.recipe.title}`}
            data-action="add-recipe"
            onClick={() => props.onAdd()}
          >
            <RemixIcon icon={PlusIcon} size={on() ? 14 : 16} />
          </button>
        </span>
      </div>
    </article>
  )
}
