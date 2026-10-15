// The update control: a button, then the stage as text, then a failure with "Retry update".
// It asks for this app's own version. The front door always runs the newest client, so that is the version to install.
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { APP_VERSION } from "../lib/version-skew";
import { reduceUpdate, stageText, type UpdateProgress } from "../lib/update";
import { userChannel } from "../sync/user-channel";
import { Button, Hint, Notice } from "./kit";

// Shared, so the banner and a settings row show the same progress.
const [progress, setProgress] = createSignal<UpdateProgress>(null);

export function UpdateAction(props: { label?: string }) {
  onMount(() => {
    const stop = userChannel.on("update.state", (frame) => setProgress(reduceUpdate(frame)));
    // A restart drops the socket. The reconnect's hello says whether the new code answered.
    const reopened = userChannel.onOpen(() => {
      if (progress()?.stage === "restarting") setProgress(null);
    });
    onCleanup(() => {
      stop();
      reopened();
    });
  });
  const start = () => {
    setProgress({ stage: "checking" });
    if (!userChannel.send({ t: "update.start", version: APP_VERSION })) setProgress({ stage: "failed", error: "Kiko is offline. Try again when it reconnects." });
  };
  return (
    <div class="inline-flex items-center gap-2" data-component="update-action">
      <Show when={progress()?.stage === "failed"}>
        <Notice data-part="update-error">{progress()?.error}</Notice>
      </Show>
      <Show
        when={stageText(progress())}
        fallback={
          <Button variant="primary" onClick={start} data-part="update-start">
            {progress()?.stage === "failed" ? "Retry update" : (props.label ?? "Update")}
          </Button>
        }
      >
        {(text) => <Hint data-part="update-progress">{text()}</Hint>}
      </Show>
    </div>
  );
}
