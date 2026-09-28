import { useEffect, useRef, useState, type FormEvent } from "react";
import { BOT_MODELS, type BotModelId } from "../../lib/roster";
import { FloatingLabelInput } from "../interior/floating-label";
import { InlineValidation } from "../interior/inline-validation";
import { LoadingButton } from "../interior/loading-button";
import { Modal } from "../interior/modal";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import BotAvatar from "./BotAvatar";

const MAX_UPLOAD_BYTES = 200 * 1024;

export interface NewBotInput {
  name: string;
  persona: string;
  instructions: string;
  modelId: BotModelId;
  avatarImage?: string;
}

export function NewBotDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NewBotInput) => void;
}) {
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState<BotModelId>("default");
  const [avatarImage, setAvatarImage] = useState<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedName = name.trim();

  useEffect(() => {
    if (!open) return;
    setName("");
    setPersona("");
    setInstructions("");
    setModelId("default");
    setAvatarImage(undefined);
    setUploadError(null);
    if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setPreviewUrl(null);
  }, [open]);

  useEffect(
    () => () => {
      if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("Image must be under 200KB.");
      return;
    }
    setUploadError(null);
    if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setPreviewUrl(objectUrl);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarImage(reader.result);
      }
    };
    reader.onerror = () => {
      setUploadError("Could not read that image.");
    };
    reader.readAsDataURL(file);
  };

  const create = () => {
    if (trimmedName.length === 0) return;
    onCreate({
      name: trimmedName,
      persona: persona.trim(),
      instructions: instructions.trim(),
      modelId,
      avatarImage,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create();
  };

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="New bot"
      maxWidth={448}
      initialFocusRef={nameInputRef}
      footer={
        <>
          <Button variant="ghost" data-testid="new-bot-cancel" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <span data-testid="new-bot-create" className="inline-flex">
            <LoadingButton
              onAction={create}
              disabled={trimmedName.length === 0}
              pendingLabel="Creating…"
              successLabel="Created"
              errorLabel="Try again"
            >
              Create bot
            </LoadingButton>
          </span>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="shrink-0" data-testid="avatar-upload-preview">
            <BotAvatar
              name={trimmedName.length > 0 ? trimmedName : "bot"}
              src={previewUrl ?? avatarImage}
              size={64}
            />
          </div>
          <div
            className="min-w-0 flex-1"
            ref={(node) => {
              nameInputRef.current = node?.querySelector("input") ?? null;
            }}
          >
            <InlineValidation
              label="Name"
              value={name}
              onChange={(value) => setName(value.slice(0, 80))}
              validate={(value) => (value.trim().length === 0 ? "Name is required." : null)}
              hint="Shown in the roster and chat."
              required
            />
          </div>
        </div>

        <FloatingLabelInput
          label="Persona"
          value={persona}
          onChange={(value) => setPersona(value)}
          hint="How should this bot come across?"
        />

        <FloatingLabelInput
          label="Instructions"
          value={instructions}
          onChange={(value) => setInstructions(value)}
          hint="What should this bot always do?"
        />

        <div className="space-y-1.5">
          <span className="text-subheadline font-medium text-foreground">Model</span>
          <Select value={modelId} onValueChange={(value) => setModelId(value as BotModelId)}>
            <SelectTrigger data-testid="new-bot-model-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {BOT_MODELS.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        <section aria-label="Avatar picker" className="space-y-3 border-t border-border/60 pt-4">
          <h3 className="text-subheadline font-medium text-foreground">Avatar</h3>
          <input
            type="file"
            accept="image/*"
            data-testid="avatar-upload-input"
            onChange={(event) => handleFile(event.target.files?.[0])}
            className="block w-full text-caption-1 text-muted-foreground file:mr-3 file:h-8 file:cursor-pointer file:rounded-[var(--control-radius)] file:border file:border-border/60 file:bg-muted file:px-3 file:text-caption-1 file:font-medium file:text-foreground"
          />
          {uploadError !== null ? (
            <p
              data-testid="avatar-upload-error"
              role="alert"
              className="text-caption-1 text-destructive-foreground"
            >
              {uploadError}
            </p>
          ) : null}
        </section>
      </form>
    </Modal>
  );
}
