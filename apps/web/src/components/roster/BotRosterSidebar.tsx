// Roster sidebar, ported from akeru's BotRosterSidebar.tsx (MIT) and stripped
// of its Effect/atom store, router, drag-and-drop, and base-ui menu layers:
// plain React state + Tailwind utilities against the lib/roster.ts contract.
// Menus, search, and tooltips come from the Interior component layer.
// Kept from akeru: iMessage-style rows (avatar, name, relative timestamp,
// one-line preview, presence, unread dot), pinned area, search filtering,
// icon rail, and the create menu.
// Rows are always the two-line card, so a row never changes height when the
// preview is empty or a bot is selected.
import { Dot } from "@workspace/ui/components/dot";
import {
  BrainIcon,
  HashIcon,
  InfoIcon,
  PencilIcon,
  PanelLeftIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import type { RosterBot, RosterGroup } from "../../lib/roster";
import {
  ContextMenu,
  Tooltip,
  TooltipGroup,
  useDropdown,
  type ContextMenuItem,
  type DropdownItem,
} from "../interior";
import { useExpandingSearch } from "../interior/expanding-search";
import { Button, Kbd } from "../ui";
import BotAvatar from "./BotAvatar";
import { BotChannelsSheet } from "./BotChannelsSheet";
import { BotDetailsPanel } from "./BotDetailsPanel";
import { BotMemorySheet } from "./BotMemorySheet";
import { BotToolsSheet } from "./BotToolsSheet";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { GroupMemberStack } from "./GroupMemberStack";
import { NewBotDialog } from "./NewBotDialog";
import { NewGroupDialog } from "./NewGroupDialog";
import { RenameGroupDialog } from "./RenameGroupDialog";
import { toast } from "../../lib/toast";
import {
  cn,
  filterRosterBots,
  filterRosterGroups,
  formatRosterTimestamp,
  groupMembers,
} from "./roster.logic";
import type { RosterApi } from "./useRosterState";

type PendingDelete = { kind: "bot" | "group"; id: string; label: string };

/** One surface model for both row kinds: interaction owns the fill. */
const ROW_SURFACE =
  "group/sidebar-row relative flex h-[var(--roster-row-height)] w-full min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-2xl px-[var(--sidebar-row-content-inset)] py-[var(--sidebar-content-inset)] text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

function rowStateClasses(isActive: boolean, selected: boolean): string {
  if (isActive) return "bg-sidebar-row-active text-sidebar-foreground";
  if (selected) return "text-sidebar-foreground ring-1 ring-ring";
  return "text-sidebar-foreground hover:bg-sidebar-row-hover";
}

function BotRow({
  bot,
  isActive,
  selected = false,
  onSelect,
}: {
  bot: RosterBot;
  isActive: boolean;
  selected?: boolean;
  onSelect: () => void;
}) {
  const sleeping = bot.presence === "sleeping";
  const meta = bot.preview;
  const stateClasses = rowStateClasses(isActive, selected);
  const metaText = isActive ? "text-sidebar-foreground/60" : "text-muted-foreground";
  const time = (
    <span
      className={cn("shrink-0 text-caption-1 tabular-nums", metaText)}
    >
      {formatRosterTimestamp(bot.updatedAt)}
    </span>
  );
  const unread =
    bot.unread > 0 ? <Dot data-testid={`roster-unread-${bot.id}`} size="md" tone="accent" /> : null;

  return (
    <button
      type="button"
      data-testid={`roster-row-${bot.id}`}
      title={bot.name}
      aria-current={isActive || undefined}
      onClick={onSelect}
      className={cn(ROW_SURFACE, stateClasses)}
    >
      <BotAvatar
        className="size-[var(--roster-avatar)]"
        name={bot.name}
        presence={bot.presence}
        src={bot.avatarImage}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex h-5 min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-subheadline",
              isActive ? "font-medium" : null,
              sleeping ? "text-sidebar-foreground/70" : "text-sidebar-foreground",
            )}
          >
            {bot.name}
          </span>
          {time}
        </span>
        <span
          className={cn(
            "mt-0.5 flex min-w-0 items-center gap-2.5 text-subheadline",
            metaText,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{meta}</span>
          {unread}
        </span>
      </span>
    </button>
  );
}

function GroupRow({
  group,
  bots,
  isActive,
  selected = false,
  onSelect,
}: {
  group: RosterGroup;
  bots: readonly RosterBot[];
  isActive: boolean;
  selected?: boolean;
  onSelect: () => void;
}) {
  const members = groupMembers(group, bots);
  const memberNames = members.map((member) => member.name).join(", ");
  const metaText = isActive ? "text-sidebar-foreground/60" : "text-muted-foreground";
  const time = (
    <span
      className={cn("shrink-0 text-caption-1 tabular-nums", metaText)}
    >
      {formatRosterTimestamp(group.updatedAt)}
    </span>
  );

  return (
    <button
      type="button"
      data-testid={`roster-row-${group.id}`}
      title={group.name}
      aria-current={isActive || undefined}
      onClick={onSelect}
      className={cn(ROW_SURFACE, rowStateClasses(isActive, selected))}
    >
      <GroupMemberStack group={group} bots={bots} sizeClassName="size-[var(--roster-avatar)]" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex h-5 min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-subheadline text-sidebar-foreground",
              isActive ? "font-medium" : null,
            )}
          >
            {group.name}
          </span>
          {time}
        </span>
        <span
          className={cn(
            "mt-0.5 flex min-w-0 items-center gap-2.5 text-subheadline",
            metaText,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{memberNames}</span>
        </span>
      </span>
    </button>
  );
}

function ReorderRow({
  id,
  draggable,
  indicator,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  children,
}: {
  id: string;
  draggable: boolean;
  indicator: "before" | "after" | null;
  onDragStart: (id: string) => (event: DragEvent) => void;
  onDragOver: (id: string) => (event: DragEvent) => void;
  onDrop: (id: string) => (event: DragEvent) => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  if (!draggable) return <>{children}</>;
  return (
    <div
      draggable
      data-testid={`roster-drag-${id}`}
      onDragStart={onDragStart(id)}
      onDragOver={onDragOver(id)}
      onDrop={onDrop(id)}
      onDragEnd={onDragEnd}
    >
      {indicator === "before" ? (
        <div data-testid="drop-indicator" className="mx-2 h-0.5 rounded bg-primary" />
      ) : null}
      {children}
      {indicator === "after" ? (
        <div data-testid="drop-indicator" className="mx-2 h-0.5 rounded bg-primary" />
      ) : null}
    </div>
  );
}

/** Pinned shelf header: the t3code section shape, always expanded. */
function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <li className="list-none">
      <div className="mx-0.5 h-8">
        <div className="flex h-full w-full items-center gap-2 px-2 text-caption-1 font-medium text-sidebar-muted-foreground">
          <PinIcon aria-hidden className="size-3 shrink-0" />
          <span className="shrink-0">{label}</span>
          <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
          <span className="shrink-0 tabular-nums">{count}</span>
        </div>
      </div>
    </li>
  );
}

/** Bare "+" ghost button opening the create menu (New bot / New group). */
function CreateMenu({ onNewBot, onNewGroup }: { onNewBot: () => void; onNewGroup: () => void }) {
  const items: DropdownItem[] = [
    { value: "bot", label: "New bot", hint: "N" },
    { value: "group", label: "New group", hint: "G" },
  ];
  const { open, activeIndex, rootRef, triggerProps, listProps, getItemProps } = useDropdown({
    items,
    onChange: (value) => {
      if (value === "bot") onNewBot();
      else if (value === "group") onNewGroup();
    },
  });
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        {...triggerProps}
        aria-label="Create"
        data-testid="roster-new-bot"
        className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground outline-none hover:bg-sidebar-control-surface hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        <PlusIcon className="size-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-float">
          <ul {...listProps} aria-label="Create" className="relative outline-none">
            {items.map((item, i) => (
              <li
                key={item.value}
                {...getItemProps(i)}
                className={cn(
                  "relative flex h-8 cursor-default select-none items-center rounded-md px-2 text-caption-1",
                  i === activeIndex ? "bg-accent text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="truncate">{item.label}</span>
                {item.hint ? (
                  <span className="meta ml-auto shrink-0 text-muted-foreground">{item.hint}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Always-open search bar: the Interior expanding-search behavior (Escape
    clears, Enter submits) rendered as the sidebar's search row. */
function RosterSearch({
  query,
  onQuery,
  resultCount,
}: {
  query: string;
  onQuery: (value: string) => void;
  resultCount: number | undefined;
}) {
  const { clear, inputProps, rootProps } = useExpandingSearch({
    value: query,
    onChange: onQuery,
    open: true,
    collapseOnBlur: false,
  });
  return (
    <div
      {...rootProps}
      role="search"
      className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-subheadline text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background"
    >
      <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
      <input
        {...inputProps}
        type="search"
        placeholder="Search"
        aria-label="Search"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent text-subheadline text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
      />
      {resultCount !== undefined ? (
        <span aria-hidden className="meta shrink-0 tabular-nums text-muted-foreground">
          {resultCount}
        </span>
      ) : null}
      {query.length > 0 ? (
        <Button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
        >
          <XIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

const byRecency = (a: RosterBot, b: RosterBot) => b.updatedAt - a.updatedAt;

export function BotRosterSidebar({
  api,
  narrowViewport,
}: {
  api: RosterApi;
  narrowViewport: boolean;
}) {
  const { bots, groups, activeId, railCollapsed } = api;
  const [query, setQuery] = useState("");
  const [newBotOpen, setNewBotOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [renameGroup, setRenameGroup] = useState<{ id: string; name: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [detailsBotId, setDetailsBotId] = useState<string | null>(null);
  const [channelsBotId, setChannelsBotId] = useState<string | null>(null);
  const [memoryBotId, setMemoryBotId] = useState<string | null>(null);
  const [toolsBotId, setToolsBotId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);
  // Phones get the icon rail regardless of the persisted rail preference.
  const showRail = railCollapsed || narrowViewport;

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  const visibleBots = useMemo(() => filterRosterBots(bots, query), [bots, query]);
  const visibleGroups = useMemo(
    () => filterRosterGroups(groups, bots, query),
    [groups, bots, query],
  );

  const pinnedBots = useMemo(
    () => visibleBots.filter((bot) => bot.pinned).sort(byRecency),
    [visibleBots],
  );
  const restBots = useMemo(
    () => visibleBots.filter((bot) => !bot.pinned).sort(byRecency),
    [visibleBots],
  );

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id !== null) api.setActive(id);
  };

  const requestDelete = (target: PendingDelete) => setPendingDelete(target);

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    if (pendingDelete.kind === "bot") api.deleteBot(pendingDelete.id);
    else api.deleteGroup(pendingDelete.id);
    toast.deleted(pendingDelete.label);
    if (selectedId === pendingDelete.id) setSelectedId(null);
    setPendingDelete(null);
  };

  // Flat keyboard order: pinned, then groups, then the rest by recency.
  const flatIds = useMemo(() => {
    if (searching) {
      return [...visibleGroups.map((group) => group.id), ...visibleBots.map((bot) => bot.id)];
    }
    return [
      ...pinnedBots.map((bot) => bot.id),
      ...visibleGroups.map((group) => group.id),
      ...restBots.map((bot) => bot.id),
    ];
  }, [searching, visibleBots, visibleGroups, pinnedBots, restBots]);

  const effectiveSelected = selectedId !== null && flatIds.includes(selectedId) ? selectedId : null;

  // Keyboard shortcuts: j/k or arrows move the selection; Enter opens; n opens
  // new-bot; e toggles the rail; p pins the selected bot; Delete asks for
  // delete confirmation. Cmd+K is owned by the global command palette.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const inField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
      // Global shortcuts bail while any dialog/menu/listbox is open.
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null) {
        return;
      }
      if (inField) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const move = (delta: number) => {
        event.preventDefault();
        if (flatIds.length === 0) return;
        const current = effectiveSelected !== null ? flatIds.indexOf(effectiveSelected) : -1;
        const next =
          current < 0
            ? delta > 0
              ? 0
              : flatIds.length - 1
            : Math.min(flatIds.length - 1, Math.max(0, current + delta));
        const id = flatIds[next];
        if (id !== undefined) {
          setSelectedId(id);
          requestAnimationFrame(() => {
            const row = document.querySelector<HTMLElement>(
              `[data-testid="roster-row-${CSS.escape(id)}"]`,
            );
            row?.scrollIntoView({ block: "nearest" });
            row?.focus({ preventScroll: true });
          });
        }
      };

      switch (event.key) {
        case "j":
        case "ArrowDown":
          move(1);
          break;
        case "k":
        case "ArrowUp":
          move(-1);
          break;
        case "Enter":
          if (effectiveSelected !== null) {
            event.preventDefault();
            api.setActive(effectiveSelected);
          }
          break;
        case "n":
          event.preventDefault();
          setNewBotOpen(true);
          break;
        case "e":
          event.preventDefault();
          api.toggleRail();
          break;
        case "p": {
          event.preventDefault();
          const bot =
            effectiveSelected !== null
              ? bots.find((candidate) => candidate.id === effectiveSelected)
              : undefined;
          if (bot !== undefined) {
            api.setItemPinned(bot.id, !bot.pinned);
            setSelectedId(bot.id);
          }
          break;
        }
        case "Delete":
        case "Backspace": {
          if (effectiveSelected === null) break;
          const bot = bots.find((candidate) => candidate.id === effectiveSelected);
          if (bot !== undefined) {
            event.preventDefault();
            requestDelete({ kind: "bot", id: bot.id, label: bot.name });
            break;
          }
          const group = groups.find((candidate) => candidate.id === effectiveSelected);
          if (group !== undefined) {
            event.preventDefault();
            requestDelete({ kind: "group", id: group.id, label: group.name });
            break;
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flatIds, effectiveSelected, bots, groups, api]);

  const handleDragStart = (id: string) => (event: DragEvent) => {
    setDragId(id);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", id);
    } catch {
      // Some browsers restrict dataTransfer access to the drop handler.
    }
  };

  const handleDragOverRow = (id: string) => (event: DragEvent) => {
    if (dragId === null || dragId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    setDropTarget((prev) =>
      prev !== null && prev.id === id && prev.before === before ? prev : { id, before },
    );
  };

  const handleDropOnRow = (id: string) => (event: DragEvent) => {
    if (dragId === null || dragId === id) return;
    event.preventDefault();
    event.stopPropagation();
    const before = dropTarget?.id === id ? dropTarget.before : true;
    setDragId(null);
    setDropTarget(null);
    if (before) {
      api.reorderItem(dragId, id);
    } else {
      // Insert after: drop before the row that follows the target in the
      // flat order, falling back to appending.
      const at = flatIds.indexOf(id);
      const next = at >= 0 ? flatIds[at + 1] : undefined;
      api.reorderItem(dragId, next ?? null);
    }
    setSelectedId(dragId);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  const botMenuItems = (bot: RosterBot): ContextMenuItem[] => [
    { id: "details", label: "Details", icon: <InfoIcon className="size-3.5" /> },
    { id: "channels", label: "Channels", icon: <HashIcon className="size-3.5" /> },
    { id: "memory", label: "Memory", icon: <BrainIcon className="size-3.5" /> },
    { id: "tools", label: "Tools", icon: <WrenchIcon className="size-3.5" /> },
    { id: "sep", type: "separator" },
    {
      id: "pin",
      label: bot.pinned ? "Unpin" : "Pin",
      shortcut: "P",
      icon: <PinIcon className="size-3.5" />,
    },
    {
      id: "delete",
      label: "Delete",
      shortcut: "⌫",
      icon: <Trash2Icon className="size-3.5 text-destructive-foreground" />,
    },
  ];

  const handleBotMenu = (bot: RosterBot) => (id: string) => {
    switch (id) {
      case "details":
        setDetailsBotId(bot.id);
        setSelectedId(bot.id);
        break;
      case "channels":
        setChannelsBotId(bot.id);
        setSelectedId(bot.id);
        break;
      case "memory":
        setMemoryBotId(bot.id);
        setSelectedId(bot.id);
        break;
      case "tools":
        setToolsBotId(bot.id);
        setSelectedId(bot.id);
        break;
      case "pin":
        api.setItemPinned(bot.id, !bot.pinned);
        break;
      case "delete":
        requestDelete({ kind: "bot", id: bot.id, label: bot.name });
        break;
      default:
        break;
    }
  };

  const groupMenuItems: ContextMenuItem[] = [
    {
      id: "rename",
      label: "Rename",
      icon: <PencilIcon className="size-3.5" />,
    },
    {
      id: "delete",
      label: "Delete",
      shortcut: "⌫",
      icon: <Trash2Icon className="size-3.5 text-destructive-foreground" />,
    },
  ];

  const handleGroupMenu = (group: RosterGroup) => (id: string) => {
    if (id === "rename") setRenameGroup({ id: group.id, name: group.name });
    else requestDelete({ kind: "group", id: group.id, label: group.name });
  };

  // Bot rows sort by recency; only group rows are reorderable.
  const renderBotRow = (bot: RosterBot) => (
    <li key={bot.id} className="list-none">
      <ContextMenu
        items={botMenuItems(bot)}
        onSelect={handleBotMenu(bot)}
        label={`${bot.name} actions`}
        width={192}
      >
        <BotRow
          bot={bot}
          isActive={activeId === bot.id}
          selected={effectiveSelected === bot.id}
          onSelect={() => select(bot.id)}
        />
      </ContextMenu>
    </li>
  );

  const renderGroupRow = (group: RosterGroup) => (
    <li key={group.id} className="list-none">
      <ReorderRow
        id={group.id}
        draggable={!searching}
        indicator={
          dropTarget !== null && dropTarget.id === group.id
            ? dropTarget.before
              ? "before"
              : "after"
            : null
        }
        onDragStart={handleDragStart}
        onDragOver={handleDragOverRow}
        onDrop={handleDropOnRow}
        onDragEnd={handleDragEnd}
      >
        <ContextMenu
          items={groupMenuItems}
          onSelect={handleGroupMenu(group)}
          label={`${group.name} actions`}
          width={192}
        >
          <GroupRow
            group={group}
            bots={bots}
            isActive={activeId === group.id}
            selected={effectiveSelected === group.id}
            onSelect={() => select(group.id)}
          />
        </ContextMenu>
      </ReorderRow>
    </li>
  );

  const detailsBot =
    detailsBotId !== null ? (bots.find((bot) => bot.id === detailsBotId) ?? null) : null;
  const channelsBot =
    channelsBotId !== null ? (bots.find((bot) => bot.id === channelsBotId) ?? null) : null;
  const memoryBot =
    memoryBotId !== null ? (bots.find((bot) => bot.id === memoryBotId) ?? null) : null;
  const toolsBot = toolsBotId !== null ? (bots.find((bot) => bot.id === toolsBotId) ?? null) : null;

  // Icon rail: avatar-only column with a create button below the expand toggle.
  if (showRail) {
    return (
      <aside
        data-testid="roster-sidebar"
        data-collapsed="true"
        className="flex h-dvh w-12 shrink-0 flex-col items-center gap-1 bg-sidebar py-2 text-sidebar-foreground"
      >
        <TooltipGroup>
          <Tooltip
            side="bottom"
            label={
              <span className="inline-flex items-center gap-1.5">
                Expand sidebar <Kbd className="h-4 min-w-4 px-1 text-[10px]">E</Kbd>
              </span>
            }
          >
            <button
              type="button"
              aria-label="Expand sidebar"
              data-testid="rail-toggle"
              onClick={api.toggleRail}
              className="flex size-8 cursor-pointer items-center justify-center rounded-[var(--control-radius)] text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              <PanelLeftIcon className="size-4" />
            </button>
          </Tooltip>
          <div className="mt-auto flex min-h-0 w-full flex-col items-center gap-1 overflow-y-auto pb-1">
            {pinnedBots.length > 0 ? (
              <span className="mb-1 size-1 rounded-full bg-muted-foreground" />
            ) : null}
            {[...pinnedBots, ...visibleBots.filter((bot) => !bot.pinned)].map((bot) => (
              <Tooltip key={bot.id} label={bot.name}>
                <button
                  type="button"
                  aria-label={bot.name}
                  data-testid={`roster-row-${bot.id}`}
                  aria-current={activeId === bot.id || undefined}
                  onClick={() => api.setActive(bot.id)}
                  className={cn(
                    "flex size-8 cursor-pointer items-center justify-center rounded-[var(--control-radius)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    activeId === bot.id
                      ? "bg-sidebar-row-active text-sidebar-foreground"
                      : "hover:bg-sidebar-row-hover",
                  )}
                >
                  <BotAvatar name={bot.name} src={bot.avatarImage} size={24} />
                </button>
              </Tooltip>
            ))}
            {visibleGroups.map((group) => (
              <Tooltip key={group.id} label={group.name}>
                <button
                  type="button"
                  aria-label={group.name}
                  data-testid={`roster-row-${group.id}`}
                  aria-current={activeId === group.id || undefined}
                  onClick={() => api.setActive(group.id)}
                  className={cn(
                    "flex size-8 cursor-pointer items-center justify-center rounded-[var(--control-radius)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    activeId === group.id
                      ? "bg-sidebar-row-active text-sidebar-foreground"
                      : "hover:bg-sidebar-row-hover",
                  )}
                >
                  <GroupMemberStack group={group} bots={bots} sizeClassName="size-5" />
                </button>
              </Tooltip>
            ))}
          </div>
        </TooltipGroup>
      </aside>
    );
  }

  return (
    <aside
      data-testid="roster-sidebar"
      data-collapsed="false"
      className="flex h-dvh w-72 shrink-0 flex-col bg-sidebar text-sidebar-foreground [--roster-avatar:2.25rem] [--roster-row-height:4.5rem]"
    >
      <header className="flex shrink-0 items-center gap-1.5 px-3 py-2">
        <Tooltip
          side="bottom"
          label={
            <span className="inline-flex items-center gap-1.5">
              Collapse sidebar <Kbd className="h-4 min-w-4 px-1 text-[10px]">E</Kbd>
            </span>
          }
        >
          <button
            type="button"
            aria-label="Collapse sidebar"
            data-testid="rail-toggle"
            onClick={api.toggleRail}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--control-radius)] text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <PanelLeftIcon className="size-4" />
          </button>
        </Tooltip>
        <RosterSearch
          query={query}
          onQuery={setQuery}
          resultCount={searching ? visibleBots.length + visibleGroups.length : undefined}
        />
        <CreateMenu onNewBot={() => setNewBotOpen(true)} onNewGroup={() => setNewGroupOpen(true)} />
      </header>

      <nav
        className="min-h-0 flex-1 overflow-y-auto ps-[calc(var(--sidebar-content-inset)+1px)] pe-[var(--sidebar-content-inset)] pb-1 pt-0"
        aria-label="Bots and groups"
      >
        <ul className="relative flex flex-col gap-px">
          {searching ? (
            <>
              {visibleGroups.map((group) => renderGroupRow(group))}
              {visibleBots.map((bot) => renderBotRow(bot))}
              {visibleBots.length === 0 && visibleGroups.length === 0 ? (
                <li className="list-none px-2 py-6 text-center text-caption-1 text-sidebar-muted-foreground">
                  No bots match
                </li>
              ) : null}
            </>
          ) : (
            <>
              {pinnedBots.length > 0 ? (
                <>
                  <SectionHeader label="Pinned" count={pinnedBots.length} />
                  {pinnedBots.map((bot) => renderBotRow(bot))}
                </>
              ) : null}

              {visibleGroups.map((group) => renderGroupRow(group))}

              {restBots.map((bot) => renderBotRow(bot))}
              {visibleBots.length === 0 && visibleGroups.length === 0 ? (
                <li className="list-none px-2 py-6 text-center text-caption-1 text-sidebar-muted-foreground">
                  No bots yet
                </li>
              ) : null}
            </>
          )}
        </ul>
      </nav>

      <NewBotDialog
        open={newBotOpen}
        onOpenChange={setNewBotOpen}
        onCreate={({ name, persona, instructions, modelId, avatarImage }) => {
          api
            .addBot(name, {
              persona,
              instructions,
              modelId,
              avatarImage,
            })
            .then(() => {
              toast.botCreated(name);
            })
            .catch((e: unknown) => {
              toast.error(`Could not create ${name}`, e);
            });
          setNewBotOpen(false);
        }}
      />
      <RenameGroupDialog
        open={renameGroup !== null}
        currentName={renameGroup?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setRenameGroup(null);
        }}
        onRename={(name) =>
          Promise.resolve(api.renameGroup(renameGroup?.id ?? "", name)).then(() => {
            toast.groupRenamed(name);
          })
        }
      />
      <NewGroupDialog
        open={newGroupOpen}
        bots={bots}
        onOpenChange={setNewGroupOpen}
        onCreate={({ name, memberIds }) =>
          api.addGroup(name, memberIds).then(() => {
            toast.groupCreated(name, memberIds.length);
            return undefined;
          })
        }
      />
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        label={pendingDelete?.label ?? "item"}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
      />
      <BotDetailsPanel
        bot={detailsBot}
        open={detailsBotId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsBotId(null);
        }}
        onUpdate={api.updateBot}
      />
      <BotChannelsSheet
        bot={channelsBot}
        open={channelsBotId !== null}
        onOpenChange={(open) => {
          if (!open) setChannelsBotId(null);
        }}
        onUpdate={api.updateBot}
      />
      <BotMemorySheet
        bot={memoryBot}
        open={memoryBotId !== null}
        onOpenChange={(open) => {
          if (!open) setMemoryBotId(null);
        }}
        onUpdate={api.updateBot}
      />
      <BotToolsSheet
        bot={toolsBot}
        open={toolsBotId !== null}
        onOpenChange={(open) => {
          if (!open) setToolsBotId(null);
        }}
        onUpdate={api.updateBot}
      />
    </aside>
  );
}
