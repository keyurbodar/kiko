import { Show } from "solid-js";
import { ChevronDown } from "lucide-solid";
import { ButtonV2 } from "@kiko/ui/v2/button-v2";

export function JumpToLatest(props: {
  arrivals: number;
  isAtBottom: boolean;
  onJump: () => void;
}) {
  return (
    <Show when={!props.isAtBottom}>
      <div class="chat-jump-slot" data-component="chat-jump-slot">
        <ButtonV2
          variant="outline"
          size="small"
          class="chat-jump"
          data-component="chat-jump"
          data-arrivals={String(props.arrivals)}
          aria-label={
            props.arrivals > 0
              ? `Jump to latest, ${props.arrivals} new message${props.arrivals === 1 ? "" : "s"}`
              : "Jump to latest"
          }
          onClick={props.onJump}
        >
          <ChevronDown size={14} />
          <Show when={props.arrivals > 0} fallback={<span>Jump to latest</span>}>
            <span>
              {props.arrivals} new message{props.arrivals === 1 ? "" : "s"}
            </span>
          </Show>
        </ButtonV2>
      </div>
    </Show>
  );
}
