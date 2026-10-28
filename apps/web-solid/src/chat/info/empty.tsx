import type { Glyph } from "@kiko/ui/icons"
import { Pictogram, type PictogramName } from "@kiko/ui/pictogram"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { type JSX, Show } from "solid-js"
import { room } from "../../state/room"

export const leadName = (): string => {
  const members = room.roomMembers()
  return (members.find((m) => m.lead) ?? members[0])?.name ?? "Kiko"
}

export function PanelEmpty(props: {
  icon?: Glyph
  art?: PictogramName
  title: string
  line: string
  action?: JSX.Element
  component: string
}) {
  return (
    <div class="flex flex-col items-center gap-1 px-4 py-10 text-center" data-component={props.component}>
      <Show when={props.art}>
        {(art) => (
          <span class="mb-2.5 grid size-[88px] place-items-center rounded-[16px] bg-[var(--bg-000)] text-[var(--text-100)] shadow-[var(--edge)]">
            <Pictogram name={art()} size={56} />
          </span>
        )}
      </Show>
      <Show when={!props.art && props.icon}>
        {(icon) => <RemixIcon icon={icon()} size={24} class="mb-1 text-fg3 opacity-(--opacity-icon-secondary)" />}
      </Show>
      <p class="text-[14.5px] leading-5 font-medium text-[var(--text-000)]">{props.title}</p>
      <p class="max-w-64 text-hint leading-[18px] text-[var(--text-300)]">{props.line}</p>
      <Show when={props.action}>
        <div class="mt-3">{props.action}</div>
      </Show>
    </div>
  )
}
