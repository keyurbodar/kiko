import { ButtonV2 } from "@kiko/ui/v2/button-v2";

export function ErrorState(props: { reason?: string; onRetry: () => void }) {
  return (
    <div class="chat-error" data-component="chat-error" role="alert">
      <p class="chat-error__reason" data-component="chat-error-reason">
        {props.reason ?? "Messages could not be loaded."}
      </p>
      <ButtonV2
        type="button"
        size="small"
        variant="outline"
        data-component="chat-error-retry"
        onClick={() => props.onRetry()}
      >
        Try again
      </ButtonV2>
    </div>
  );
}
