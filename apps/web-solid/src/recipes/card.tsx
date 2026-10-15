import type { RecipeCard } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ClockIcon } from "@kiko/ui/icons"
import { For, Show } from "solid-js"
import { AgentChip } from "../chat/ui/agent-chip"
import { Button } from "../settings/kit"
import { RecipeApps } from "./apps"
import { RecipeIcon } from "./recipe-icon"
import { agentName, installsFor, routinesFor } from "./state"

export function RecipeTile(props: { recipe: RecipeCard; onOpen: (agent?: string) => void; onAdd: () => void }) {
  const agents = () => [...new Set(installsFor(props.recipe.slug).map((i) => i.agent))]
  const routineLabel = () => {
    const count = routinesFor(props.recipe.slug).length
    if (count) return `${count} ${count === 1 ? "routine" : "routines"}`
    const installs = installsFor(props.recipe.slug)
    return installs.length && installs.every((i) => i.routines !== undefined) ? "No routines" : props.recipe.when
  }
  return <article class="relative flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4" data-recipe={props.recipe.slug}>
    <button type="button" class="flex flex-col gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-xl" data-action="open-recipe" onClick={() => props.onOpen()}>
      <span class="flex min-h-10 items-center gap-3">
        <RecipeIcon recipe={props.recipe} size={40} />
        <span class="min-w-0 text-md font-medium leading-snug text-foreground">{props.recipe.title}</span>
      </span>
      <span class="line-clamp-3 min-h-[54px] text-sm leading-[18px] text-muted-foreground">{props.recipe.description}</span>
    </button>
    <div class="flex min-h-6 items-start"><RecipeApps apps={props.recipe.apps} /></div>
    <button type="button" class="relative flex min-h-5 items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground" data-action="recipe-routines" onClick={() => props.onOpen()}>
      <HugeIcon icon={ClockIcon} size={13} />
      <span class="truncate">{routineLabel()}</span>
    </button>
    <div class="relative mt-auto flex min-h-7 items-center justify-between gap-3">
      <div class="flex min-w-0 flex-wrap items-center gap-1 text-xs">
        <For each={agents().slice(0, 2)}>{(agent) => <button type="button" class="cursor-pointer" aria-label={`Show recipe for ${agentName(agent)}`} onClick={() => props.onOpen(agent)}><AgentChip slug={agent} name={agentName(agent)} /></button>}</For>
        <Show when={agents().length > 2}><button type="button" class="text-xs text-muted-foreground" onClick={() => props.onOpen()}>+{agents().length - 2}</button></Show>
      </div>
      <Button class="shrink-0" data-action="add-recipe" onClick={() => props.onAdd()}>Add</Button>
    </div>
  </article>
}
