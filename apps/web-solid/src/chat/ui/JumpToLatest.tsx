import { Show } from "solid-js"
import { ButtonV2 } from "@kiko/ui/v2/button-v2"
import { Icon } from "@kiko/ui/v2/icon"

/**
 * The pill that appears when the reader has scrolled up and the thread keeps
 * moving. It carries the count of arrivals so they know how much they are
 * about to skip, and it lives in the stage — an absolutely positioned overlay
 * above the scroller — so it does not scroll away with the content.
 *
 * `visible` is the parent's read of the scroll position. The pill is always in
 * the DOM and toggled by `data-visible` on the button, because chat.css hides
 * it with `display: none` and there is nothing to animate between the two
 * states anyway.
 */
export function JumpToLatest(props: {
  /** How many rows arrived while the reader was away from the bottom. */
  arrivals: number
  /** False while the reader is parked anywhere but the end of the thread. */
  visible: boolean
  onJump: () => void
}) {
  const label = () =>
    props.arrivals > 0
      ? `${props.arrivals} new message${props.arrivals === 1 ? "" : "s"}`
      : "jump to latest"

  return (
    <div class="chat-jump-latest" data-component="chat-jump-latest">
      {/*
        ButtonV2 writes its own `data-component="button-v2"` after the prop
        spread, so a `data-component` handle passed here would be silently
        dropped. The stable handle for this pill is the `chat-jump` class,
        which chat.css already keys `.chat-jump-latest > button` off.
      */}
      <ButtonV2
        variant="ghost"
        size="normal"
        class="chat-jump"
        data-part="pill"
        data-visible={props.visible ? "" : undefined}
        data-arrivals={String(props.arrivals)}
        aria-label={props.arrivals > 0 ? `${label()}, jump to the end of the thread` : label()}
        onClick={props.onJump}
      >
        <Icon name="chevron-down" size="small" />
        <Show when={props.arrivals > 0} fallback={<span>{"jump to latest"}</span>}>
          <span>{label()}</span>
        </Show>
      </ButtonV2>
    </div>
  )
}
