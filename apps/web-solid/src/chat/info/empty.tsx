import type { Glyph } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { type JSX, Show } from "solid-js"
import { room } from "../../state/room"

export const leadName = (): string => {
  const members = room.roomMembers()
  return (members.find((m) => m.lead) ?? members[0])?.name ?? "Kiko"
}

export function PanelEmpty(props: {
  icon: Glyph
  title: string
  line: string
  action?: JSX.Element
  component: string
}) {
  return (
    <div class="flex flex-col items-center gap-1 px-4 py-10 text-center" data-component={props.component}>
      <RemixIcon icon={props.icon} size={24} class="mb-1 text-fg3 opacity-(--opacity-icon-secondary)" />
      <p class="type-ui text-fg">{props.title}</p>
      <p class="max-w-64 type-label text-fg3">{props.line}</p>
      <Show when={props.action}>
        <div class="mt-3">{props.action}</div>
      </Show>
    </div>
  )
}
