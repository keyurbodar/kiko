// Group creation dialog, ported from akeru's NewGroupDialog.tsx (MIT) and
// reduced to the RosterGroup contract: a name plus a multi-select of member
// bots (akeru's boss/specialist split has no equivalent in the contract).
import { useEffect, useRef, useState } from "react";
import type { RosterBot } from "../../lib/roster";
import { FloatingLabelInput } from "../interior/floating-label";
import { LoadingButton } from "../interior/loading-button";
import { Modal } from "../interior/modal";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import BotAvatar from "./BotAvatar";

export function canCreateGroup(name: string, selectedIds: readonly string[]): boolean {
  return name.trim().length > 0 && new Set(selectedIds).size >= 2;
}

export function NewGroupDialog({
  open,
  bots,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  bots: readonly RosterBot[];
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; memberIds: string[] }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedName = name.trim();
  const liveSelectedIds = selectedIds.filter((id) => bots.some((bot) => bot.id === id));

  useEffect(() => {
    if (!open) return;
    setName("");
    setSelectedIds(bots.slice(0, 2).map((bot) => bot.id));
  }, [open]);

  const toggleMember = (botId: string) => {
    setSelectedIds((prev) =>
      prev.includes(botId) ? prev.filter((id) => id !== botId) : [...prev, botId],
    );
  };

  const submit = () => {
    if (busy || !canCreateGroup(trimmedName, liveSelectedIds)) return;
    setBusy(true);
    setError(null);
    return onCreate({ name: trimmedName, memberIds: liveSelectedIds }).then(
      () => {
        setBusy(false);
        onOpenChange(false);
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="New group"
      maxWidth={448}
      initialFocusRef={nameInputRef}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <span data-testid="new-group-create" className="inline-flex">
            <LoadingButton
              onAction={submit}
              disabled={busy || !canCreateGroup(trimmedName, liveSelectedIds)}
              pendingLabel="Creating…"
              successLabel="Created"
              errorLabel="Try again"
            >
              Create group
            </LoadingButton>
          </span>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <FloatingLabelInput
          label="Name"
          value={name}
          onChange={(value) => setName(value.slice(0, 80))}
          inputRef={nameInputRef}
          required
        />

        <fieldset className="space-y-1.5">
          <legend className="text-subheadline font-medium text-foreground">Members</legend>
          <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg bg-input/30 p-1">
            {bots.map((bot) => {
              const checked = selectedIds.includes(bot.id);
              return (
                <div
                  key={bot.id}
                  role="button"
                  tabIndex={-1}
                  onClick={() => toggleMember(bot.id)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-subheadline text-foreground hover:bg-accent"
                >
                  <Checkbox
                    data-testid={`new-group-member-${bot.id}`}
                    checked={checked}
                    onCheckedChange={() => toggleMember(bot.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <BotAvatar name={bot.name} src={bot.avatarImage} size={20} />
                  <span className="truncate">{bot.name}</span>
                </div>
              );
            })}
          </div>
        </fieldset>
        {error !== null ? (
          <p role="alert" data-testid="new-group-error" className="text-caption-1 text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
