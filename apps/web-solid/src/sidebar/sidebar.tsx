import { createEventListener } from "@solid-primitives/event-listener"
import { Icon } from "@kiko/ui/v2/icon"
import { IconButtonV2 } from "@kiko/ui/v2/icon-button-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import type { SidebarProps } from "../lib/types"
import { BotAvatar, GroupMemberStack } from "./bot-avatar"
import {
  formatRosterTime,
  groupMemberNames,
  moveActiveId,
  orderRoster,
  rowDomId,
  type RosterRecord,
} from "./roster-logic"
import { SearchField } from "./search-field"
import { SidebarList, type SidebarListItem } from "./sidebar-list"
import { RailItem, ThreadRow } from "./thread-row"
import "./sidebar.css"

const NAV_KEYS: Readonly<Record<string, true>> = {
  ArrowDown: true,
  ArrowUp: true,
  j: true,
  k: true,
  Home: true,
  End: true,
}

const RAIL_AVATAR_SIZE = 30
const RAIL_STACK_SIZE = 36


export interface RosterAction {
  id: string
  label: string
  icon?: string
  shortcut?: string
  danger?: boolean
}


type ListEntry = { kind: "header"; label: string; count: number } | { kind: "row"; id: string }

const DEFAULT_ACTIONS: readonly RosterAction[] = [
  { id: "details", label: "Details" },
  { id: "channels", label: "Channels" },
  { id: "memory", label: "Memory" },
  { id: "tools", label: "Tools" },
  { id: "pin", label: "Pin", shortcut: "P" },
  { id: "delete", label: "Delete", shortcut: "⌫", danger: true },
]

export interface SidebarSliceProps extends SidebarProps {
  initialCollapsed?: boolean
  actions?: readonly RosterAction[]
  onAction?: (action: RosterAction, threadId: string) => void
  onCreateAgent?: () => void
  onCreateGroup?: () => void
}

export function Sidebar(props: SidebarSliceProps): JSX.Element {
  const now = Date.now()

  const [collapsed, setCollapsed] = createSignal(props.initialCollapsed ?? false)
  const [query, setQuery] = createSignal("")
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [menuId, setMenuId] = createSignal<string | null>(null)

  const records = createMemo<RosterRecord[]>(() =>
    props.bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      hay: `${bot.name}\n${bot.preview}`.toLowerCase(),
      updatedAt: bot.updatedAt,
      pinned: bot.pinned,
    })),
  )
  const groups = createMemo(() => props.groups.map((group) => ({ ...group })))

  const order = createMemo(() => orderRoster(records(), groups(), query()))
  const flatIds = createMemo(() => order().flatIds)
  const searching = createMemo(() => query().trim().length > 0)
  const botsById = createMemo(() => new Map(props.bots.map((bot) => [bot.id, bot])))
  const groupsById = createMemo(() => new Map(props.groups.map((group) => [group.id, group])))
  const bot = (id: string) => botsById().get(id)
  const group = (id: string) => groupsById().get(id)
  const canCreate = () => props.onCreateAgent !== undefined || props.onCreateGroup !== undefined
  const actions = () => props.actions ?? (props.onAction === undefined ? [] : DEFAULT_ACTIONS)

  const items = createMemo<readonly SidebarListItem<ListEntry>[]>(() => {
    const out: SidebarListItem<ListEntry>[] = []
    for (const section of order().sections) {
      if (section.header !== null) {
        out.push({
          key: `header:${section.id}`,
          value: { kind: "header", label: section.header, count: section.ids.length },
        })
      }
      for (const id of section.ids) {
        out.push({ key: `row:${id}`, value: { kind: "row", id } })
      }
    }
    return out
  })

  createEffect(() => {
    const ids = flatIds()
    if (ids.includes(activeId() ?? "")) return
    const current = props.activeThreadId
    setActiveId(current !== null && ids.includes(current) ? current : (ids[0] ?? null))
  })

  const select = (id: string) => {
    setActiveId(id)
    props.onSelectThread(id)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (document.querySelector('[role="dialog"], [role="menu"]') !== null) return
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return

    if (event.key === "Escape") {
      if (query().length > 0) setQuery("")
      return
    }

    if (event.key === "e") {
      setCollapsed((value) => !value)
      return
    }

    if (NAV_KEYS[event.key] !== true) return
    event.preventDefault()
    const next = moveActiveId(flatIds(), activeId(), event.key)
    if (next === null) return
    setActiveId(next)
    document.getElementById(rowDomId(next))?.focus()
  }

  createEventListener(document, "keydown", onKeyDown)

  const targetId = () => menuId() ?? activeId() ?? flatIds()[0] ?? ""

  const runAction = (action: RosterAction) => {
    props.onAction?.(action, targetId())
    setMenuId(null)
  }

  const menuItems = () => (
    <>
      <MenuV2.Item onSelect={() => select(targetId())}>Open</MenuV2.Item>
      <For each={actions()}>
        {(action, index) => (
          <>
            <Show when={index() === 0}>
              <MenuV2.Separator />
            </Show>
            <MenuV2.Item
              shortcut={action.shortcut}
              class={action.danger ? "text-error" : undefined}
              onSelect={() => runAction(action)}
            >
              {action.label}
            </MenuV2.Item>
          </>
        )}
      </For>
    </>
  )

  const railAvatar = (id: string): JSX.Element => {
    const member = bot(id)
    if (member) {
      return <BotAvatar name={member.name} src={member.avatarImage} size={RAIL_AVATAR_SIZE} />
    }
    const conversation = group(id)
    if (!conversation) return <BotAvatar name={id} size={RAIL_AVATAR_SIZE} />
    return <GroupMemberStack group={conversation} bots={() => props.bots} size={RAIL_STACK_SIZE} />
  }

  const rowFor = (id: string) => (
    <ThreadRow
      id={id}
      bot={() => bot(id)}
      group={() => group(id)}
      bots={() => props.bots}
      active={() => activeId() === id}
      presence={() => bot(id)?.presence}
      unread={() => bot(id)?.unread ?? 0}
      memberNames={() => {
        const conversation = group(id)
        return conversation ? groupMemberNames(conversation, records()) : ""
      }}
      time={() => formatRosterTime(bot(id)?.updatedAt ?? group(id)?.updatedAt ?? 0, now)}
      onSelect={select}
    />
  )

  return (
    <aside data-component="sidebar" data-collapsed={collapsed() ? "true" : "false"}>
      <div data-slot="sidebar-header">
        <IconButtonV2
          data-slot="sidebar-rail-toggle"
          variant="ghost-muted"
          size="normal"
          icon={<Icon name="sidebar-right" size="normal" />}
          aria-label={collapsed() ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed()}
          onClick={() => setCollapsed((value) => !value)}
        />
        <Show when={!collapsed()}>
          <SearchField
            value={query}
            onValue={setQuery}
            resultCount={() => (searching() ? flatIds().length : undefined)}
          />
          <Show when={canCreate()}>
            <MenuV2 gutter={6} modal={false} placement="bottom-end">
              <MenuV2.Trigger
                as={IconButtonV2}
                data-slot="sidebar-create"
                variant="ghost-muted"
                size="normal"
                icon={<Icon name="plus" size="normal" />}
                aria-label="Create"
              />
              <MenuV2.Portal>
                <MenuV2.Content>
                  <Show when={props.onCreateAgent}>
                    <MenuV2.Item onSelect={() => props.onCreateAgent?.()}>New agent</MenuV2.Item>
                  </Show>
                  <Show when={props.onCreateGroup}>
                    <MenuV2.Item onSelect={() => props.onCreateGroup?.()}>New group</MenuV2.Item>
                  </Show>
                </MenuV2.Content>
              </MenuV2.Portal>
            </MenuV2>
          </Show>
        </Show>
      </div>

      <Show
        when={!collapsed()}
        fallback={
          <div data-slot="sidebar-rail">
            <Show when={order().sections.some((section) => section.id === "pinned")}>
              <span data-slot="sidebar-rail-separator" />
            </Show>
            <div data-slot="sidebar-rail-scroll">
              <For each={flatIds()}>
                {(id) => (
                  <RailItem
                    id={id}
                    label={bot(id)?.name ?? group(id)?.name ?? id}
                    active={() => props.activeThreadId === id}
                    onSelect={select}
                    avatar={railAvatar(id)}
                  />
                )}
              </For>
            </div>
          </div>
        }
      >
        <MenuV2.Context>
          <MenuV2.Context.Trigger
            as="div"
            class="flex min-h-0 flex-1 flex-col"
            onContextMenu={(event: MouseEvent) => {
              const trigger = (event.target as HTMLElement | null)?.closest<HTMLElement>(
                '[data-component="sidebar-row"]',
              )
              if (trigger?.id) setMenuId(trigger.id.replace("sidebar-row-", ""))
            }}
          >
            <SidebarList
              items={items()}
              label="Bots and groups"
              empty={
                <p data-slot="sidebar-empty">
                  {searching() ? "No bots match" : "No bots yet"}
                </p>
              }
              entry={(item) =>
                item.value.kind === "header" ? (
                  <div data-slot="sidebar-section-header">
                    <span>{item.value.label}</span>
                    <span data-slot="sidebar-section-count">{item.value.count}</span>
                  </div>
                ) : (
                  rowFor(item.value.id)
                )
              }
            />
            <MenuV2.Context.Portal>
              <MenuV2.Context.Content data-portal-owner="sidebar">
                {menuItems()}
              </MenuV2.Context.Content>
            </MenuV2.Context.Portal>
          </MenuV2.Context.Trigger>
          </MenuV2.Context>
      </Show>
    </aside>
  )
}

export default Sidebar
