import { useEffect, useMemo, useState } from "react";
import { CommandPalette, type CommandItem } from "./interior/command-palette";
import BotAvatar from "./roster/BotAvatar";
import { GroupMemberStack } from "./roster/GroupMemberStack";
import { NewBotDialog } from "./roster/NewBotDialog";
import { NewGroupDialog } from "./roster/NewGroupDialog";
import type { RosterApi } from "./roster/useRosterState";

export function CommandPaletteHost({ api }: { api: RosterApi }) {
  const [open, setOpen] = useState(false);
  const [newBotOpen, setNewBotOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  // Remounts the palette per open so its autoFocus effect refires.
  const [session, setSession] = useState(0);

  // Capture phase so this fires before the sidebar's bubble-phase Cmd+K
  // (which focuses its search box); stopImmediatePropagation keeps both
  // handlers from reacting to the same keystroke.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (open) {
        setOpen(false);
        return;
      }
      if (document.querySelector('[role="dialog"], [role="menu"]') !== null) return;
      setSession((n) => n + 1);
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const items = useMemo<CommandItem[]>(
    () => [
      ...api.groups.map((group) => ({
        id: `group:${group.id}`,
        label: group.name,
        hint: `Group · ${group.memberIds.length} members`,
        keywords: "group chat",
        icon: <GroupMemberStack group={group} bots={api.bots} sizeClassName="size-5" />,
      })),
      ...api.bots.map((bot) => ({
        id: `bot:${bot.id}`,
        label: bot.name,
        hint: "Bot",
        keywords: "bot chat",
        icon: (
          <span className="flex size-5 items-center justify-center rounded-full">
            <BotAvatar name={bot.name} src={bot.avatarImage} className="size-full" />
          </span>
        ),
      })),
      {
        id: "action:new-bot",
        label: "New bot",
        hint: "Action",
        keywords: "create bot",
        shortcut: ["N"],
      },
      { id: "action:new-group", label: "New group", hint: "Action", keywords: "create group" },
      {
        id: "action:toggle-sidebar",
        label: "Toggle sidebar",
        hint: "Action",
        keywords: "rail collapse",
        shortcut: ["E"],
      },
    ],
    [api.bots, api.groups],
  );

  const onSelect = (item: CommandItem) => {
    setOpen(false);
    if (item.id.startsWith("bot:")) {
      api.setActive(item.id.slice(4));
    } else if (item.id.startsWith("group:")) {
      api.setActive(item.id.slice(6));
    } else if (item.id === "action:new-bot") {
      setNewBotOpen(true);
    } else if (item.id === "action:new-group") {
      setNewGroupOpen(true);
    } else if (item.id === "action:toggle-sidebar") {
      api.toggleRail();
    }
  };

  return (
    <>
      <CommandPalette
        key={session}
        open={open}
        items={items}
        onSelect={onSelect}
        onDismiss={() => setOpen(false)}
        placeholder="Search bots, groups, actions"
        emptyLabel="No matches"
        label="Command palette"
        autoFocus
      />
      <NewBotDialog
        open={newBotOpen}
        onOpenChange={setNewBotOpen}
        onCreate={({ name, persona, instructions, modelId, avatarImage }) => {
          api
            .addBot(name, { persona, instructions, modelId, avatarImage })
            .catch((e: unknown) => {
              console.error("create bot failed", e instanceof Error ? e.message : e);
            });
          setNewBotOpen(false);
        }}
      />
      <NewGroupDialog
        open={newGroupOpen}
        bots={api.bots}
        onOpenChange={setNewGroupOpen}
        onCreate={({ name, memberIds }) => api.addGroup(name, memberIds).then(() => undefined)}
      />
    </>
  );
}
