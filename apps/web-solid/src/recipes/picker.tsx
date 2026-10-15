import type { RecipeCard } from "@kiko/protocol"
import { createSignal, For, Show } from "solid-js"
import { AgentChip } from "../chat/ui/agent-chip"
import { useApp } from "../lib/store"
import { Button, fieldClass } from "../settings/kit"
import { addOwnChat, addToTarget, isAdded, isOwning, targetsForChat } from "./state"

export function RecipePicker(props: { recipe: RecipeCard; roomId?: string | null; navigate: (to: string) => void }) {
  const [selected, setSelected] = createSignal<string | null>(props.roomId ?? null)
  const [query, setQuery] = createSignal("")
  const chats = () => useApp.bots().filter((chat) => chat.name.toLowerCase().includes(query().toLowerCase()))
  const chooseChat = (id: string) => {
    const targets = targetsForChat(id)
    if (targets.length === 1 && !isAdded(props.recipe.slug, targets[0])) addToTarget(props.recipe, targets[0], props.navigate)
    else setSelected(id)
  }
  return <div class="flex flex-col gap-4" data-component="recipe-picker">
    <Show when={selected()} fallback={<>
      <p class="text-sm text-muted-foreground">Choose a chat for this recipe.</p>
      <input type="search" class={fieldClass} placeholder="Search chats" aria-label="Search chats for recipe" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
      <div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
        <For each={chats()}>{(chat) => {
          const targets = () => targetsForChat(chat.id)
          const added = () => targets().length > 0 && targets().every((t) => isAdded(props.recipe.slug, t))
          return <button type="button" class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-3 text-left hover:bg-control disabled:cursor-default" disabled={added()} onClick={() => chooseChat(chat.id)}>
            <span class="flex min-w-0 flex-col gap-1">
              <Show when={targets().length !== 1 || targets()[0]?.name !== chat.name}><span class="truncate text-sm font-medium">{chat.name}</span></Show>
              <span class="flex flex-wrap gap-1 text-xs"><For each={targets()}>{(t) => <AgentChip slug={t.agent} name={t.name} />}</For></span>
            </span>
            <span class="shrink-0 text-xs text-muted-foreground">{added() ? "Already added" : targets().length > 1 ? "Choose agent" : "Add"}</span>
          </button>
        }}</For>
        <Show when={!chats().length}><p class="px-3 py-4 text-sm text-muted-foreground">No chats match.</p></Show>
      </div>
    </>}>
      {(roomId) => <>
        <div class="flex items-center gap-3">
          <button type="button" class="cursor-pointer text-sm text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)}>Back</button>
          <p class="min-w-0 truncate text-sm font-medium">{useApp.chatById(roomId())?.name ?? "Choose an agent"}</p>
        </div>
        <div class="flex flex-col gap-1">
          <For each={targetsForChat(roomId())}>{(target) => <button type="button" class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-3 text-left hover:bg-control disabled:cursor-default" disabled={isAdded(props.recipe.slug, target)} onClick={() => addToTarget(props.recipe, target, props.navigate)}>
            <span class="text-sm"><AgentChip slug={target.agent} name={target.name} /></span>
            <span class="text-xs text-muted-foreground">{isAdded(props.recipe.slug, target) ? "Already added" : "Add"}</span>
          </button>}</For>
        </div>
      </>}
    </Show>
    <Button class="w-full" data-action="recipe-own-chat" disabled={isOwning(props.recipe.slug)} onClick={() => addOwnChat(props.recipe, props.navigate)}>{isOwning(props.recipe.slug) ? "Creating chat…" : "Create a dedicated chat"}</Button>
  </div>
}
