import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"
import type { BotPresence, RosterBot, RosterGroup } from "../lib/types"
import { BotAvatar, GroupMemberStack } from "./bot-avatar"
import { rowDomId } from "./roster-logic"

const AVATAR_SIZE = 40

export function ThreadRow(props: {
  id: string
  bot: () => RosterBot | undefined
  group: () => RosterGroup | undefined
  bots: () => readonly RosterBot[]
  active: () => boolean
  unread: () => number
  presence: () => BotPresence | undefined
  memberNames: () => string
  time: () => string
  onSelect: (id: string) => void
}): JSX.Element {
  const name = () => props.bot()?.name ?? props.group()?.name ?? props.id
  const meta = () => props.bot()?.preview ?? props.memberNames()

  return (
    <li data-slot="sidebar-item">
      <button
        type="button"
        id={rowDomId(props.id)}
        title={name()}
        aria-current={props.active() ? "true" : undefined}
        data-component="sidebar-row"
        data-active={props.active() ? "" : undefined}
        data-unread={props.unread() > 0 ? "" : undefined}
        data-presence={props.presence()}
        tabIndex={props.active() ? 0 : -1}
        onClick={() => props.onSelect(props.id)}
      >
        <Show
          when={props.bot()}
          fallback={
            <GroupMemberStack
              group={props.group() ?? { memberIds: [] }}
              bots={props.bots}
              size={AVATAR_SIZE}
            />
          }
        >
          {(bot) => (
            <BotAvatar
              name={bot().name}
              src={bot().avatarImage}
              presence={props.presence()}
              size={AVATAR_SIZE}
            />
          )}
        </Show>
        <span data-slot="sidebar-row-text">
          <span data-slot="sidebar-row-line">
            <span data-slot="sidebar-row-name">{name()}</span>
            <span data-slot="sidebar-row-time">{props.time()}</span>
          </span>
          <span data-slot="sidebar-row-line">
            <span data-slot="sidebar-row-preview">{meta()}</span>
            <Show when={props.unread() > 0}>
              <span data-slot="sidebar-row-unread" />
            </Show>
          </span>
        </span>
      </button>
    </li>
  )
}

export function RailItem(props: {
  id: string
  label: string
  active: () => boolean
  onSelect: (id: string) => void
  avatar: JSX.Element
}): JSX.Element {
  return (
    <TooltipV2 value={props.label} placement="right" contentClass="sidebar-portal">
      <button
        type="button"
        data-component="sidebar-rail-item"
        aria-label={props.label}
        aria-current={props.active() ? "true" : undefined}
        onClick={() => props.onSelect(props.id)}
      >
        {props.avatar}
      </button>
    </TooltipV2>
  )
}
