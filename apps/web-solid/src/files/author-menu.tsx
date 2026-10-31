import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, GroupIcon, UserIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { For, Match, Show, Switch } from "solid-js"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { agentDisplayName } from "../lib/names"
import { room } from "../state/room"
import { user } from "../state/user"
import type { Author, AuthorFacets } from "./author"

const chatTitle = (roomId: string) => room.chatById(roomId)?.name ?? user.chat(roomId)?.title ?? "A chat"

function AuthorFace(props: { author: Author }) {
  return (
    <Switch fallback={<RemixIcon icon={GroupIcon} size={16} class="shrink-0 text-tertiary" />}>
      <Match when={props.author === "you"}>
        <RemixIcon icon={UserIcon} size={16} class="shrink-0 text-tertiary" />
      </Match>
      <Match when={props.author.startsWith("agent:")}>
        <IdentityAvatar seed={props.author.slice(6)} size={18} class="shrink-0" />
      </Match>
      <Match when={props.author.startsWith("chat:")}>
        <ChatAvatar faces={room.chatFaces(props.author.slice(5))} size={18} />
      </Match>
    </Switch>
  )
}

function authorLabel(author: Author): string {
  if (author === "all") return "Everyone"
  if (author === "you") return "You"
  if (author.startsWith("agent:")) return agentDisplayName(author.slice(6), user.agents())
  return chatTitle(author.slice(5))
}

function Row(props: { author: Author; count: number }) {
  return (
    <MenuV2.RadioItem value={props.author} data-author={props.author} closeOnSelect>
      <span class="flex min-w-0 flex-1 items-center gap-2.5">
        <AuthorFace author={props.author} />
        <span class="truncate">{authorLabel(props.author)}</span>
      </span>
      <span class="type-xs ml-3 text-quaternary">{props.count}</span>
    </MenuV2.RadioItem>
  )
}

export function AuthorMenu(props: {
  value: Author
  facets: AuthorFacets
  total: number
  onChange: (author: Author) => void
}) {
  return (
    <MenuV2 gutter={6} placement="bottom-start">
      <MenuV2.Trigger
        class="type-base flex h-control-xl max-w-64 min-w-0 cursor-pointer items-center gap-2 rounded-base px-3 font-medium text-secondary transition-[background-color,color,transform] duration-(--duration-fast) hover:bg-tertiary hover:text-primary active:scale-[0.97] aria-expanded:bg-tertiary aria-expanded:text-primary data-[picked]:bg-secondary data-[picked]:text-primary"
        aria-label={`Show files from ${authorLabel(props.value)}`}
        data-action="filter-author"
        data-picked={props.value === "all" ? undefined : ""}
      >
        <AuthorFace author={props.value} />
        <span class="truncate">{props.value === "all" ? "From everyone" : authorLabel(props.value)}</span>
        <RemixIcon icon={ChevronDownIcon} size={12} class="shrink-0 opacity-70" />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="max-h-96 min-w-60" data-component="files-author-menu">
          <MenuV2.RadioGroup value={props.value} onChange={(v) => props.onChange(v as Author)}>
            <Row author="all" count={props.total} />
            <Show when={props.facets.you}>
              <Row author="you" count={props.facets.you} />
            </Show>
            <Show when={props.facets.agents.length}>
              <MenuV2.Separator />
              <MenuV2.GroupLabel>Agents</MenuV2.GroupLabel>
              <For each={props.facets.agents}>{(a) => <Row author={`agent:${a.slug}`} count={a.count} />}</For>
            </Show>
            <Show when={props.facets.chats.length}>
              <MenuV2.Separator />
              <MenuV2.GroupLabel>Chats</MenuV2.GroupLabel>
              <For each={props.facets.chats}>{(c) => <Row author={`chat:${c.roomId}`} count={c.count} />}</For>
            </Show>
          </MenuV2.RadioGroup>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
