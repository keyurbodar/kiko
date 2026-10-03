import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { IdentityAvatar } from "../../lib/IdentityAvatar";
import { Bird } from "../../mascot/bird";
import { describe } from "./create-typing-presence";
import { SURFACE_SPRING } from "./spring";
import "./typing.css";

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const LEAVE = "cubic-bezier(0.4, 0, 1, 1)";
const SEND_MS = 340;

export interface TypingIndicatorProps {
  typists: string[];
  /** The first typist's slug, so the avatar matches the agent everywhere else. Falls back to the name. */
  seed?: string;
  sending?: boolean;
  max?: number;
  /** What the one typist is doing, such as "editing /hello.html". Replaces "is typing". */
  doing?: string;
  /** Group chat: draw the typing agent's small avatar at the bubble's left. */
  avatar?: boolean;
  announceAfter?: number;
  class?: string;
}

function createReducedMotion() {
  const query = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [reduced, setReduced] = createSignal(query?.matches ?? false);
  if (query) {
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    onCleanup(() => query.removeEventListener("change", onChange));
  }
  return reduced;
}

/** Runs one animation on `el`, holding its end state and replacing the previous one. */
function play(
  el: HTMLElement,
  slot: { current: Animation | null },
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation {
  const prev = slot.current;
  if (prev) {
    try {
      prev.commitStyles();
    } catch {
      /* the element is not rendered */
    }
    prev.cancel();
  }
  const animation = el.animate(frames, { fill: "forwards", ...options });
  slot.current = animation;
  return animation;
}

export function TypingIndicator(props: TypingIndicatorProps) {
  const reduced = createReducedMotion();
  const max = () => props.max ?? 2;
  const label = createMemo(() =>
    props.doing && props.typists.length === 1 && props.doing !== "writing a reply" ? `${props.typists[0]} is ${props.doing}` : describe(props.typists, max()),
  );
  const active = () => props.typists.length > 0;
  // The bird acts out what the agent reports: a reply on its way, a tool at work, or typing.
  const birdState = () => (props.sending ? "sending" : props.doing && props.doing !== "writing a reply" ? "working" : "typing");

  let bubble!: HTMLDivElement;
  const bubbleAnim = { current: null as Animation | null };

  // The bubble: enter on active, shrink on send, leave on inactive.
  createEffect(
    on(
      () => [active(), props.sending === true] as const,
      ([isActive, isSending], previous) => {
        const wasActive = previous?.[0] ?? false;
        const wasSending = previous?.[1] ?? false;
        if (reduced()) {
          if (!isActive && !wasActive) return;
          play(bubble, bubbleAnim, [{ opacity: isActive ? 1 : 0 }], { duration: 0 });
          return;
        }
        if (isActive && isSending) {
          play(bubble, bubbleAnim, [{ opacity: 0, transform: "scale(0.45)" }], { duration: SEND_MS, easing: LEAVE });
        } else if (isActive) {
          if (wasActive && !wasSending) return;
          play(
            bubble,
            bubbleAnim,
            [
              { opacity: 0, transform: "scale(0.74)" },
              { opacity: 1, transform: "scale(1)" },
            ],
            { duration: SURFACE_SPRING.duration, easing: SURFACE_SPRING.easing },
          );
        } else if (wasActive && !wasSending) {
          play(bubble, bubbleAnim, [{ opacity: 0, transform: "scale(0.4)" }], { duration: 260, easing: EASE });
        }
        // Inactive after a send: the bubble is already at opacity 0.
      },
    ),
  );

  // The screen reader text trails the typing state. It is the only label.
  const [announced, setAnnounced] = createSignal(label());
  createEffect(
    on(
      label,
      (text) => {
        const timer = setTimeout(() => setAnnounced(text), props.announceAfter ?? 700);
        onCleanup(() => clearTimeout(timer));
      },
      { defer: true },
    ),
  );

  onMount(() => {
    if (active()) play(bubble, bubbleAnim, [{ opacity: 1, transform: "scale(1)" }], { duration: 0 });
  });

  return (
    <div class={`typing ${props.class ?? ""}`} data-component="typing-indicator">
      <Show when={props.avatar && props.typists[0]}>
        {(name) => <IdentityAvatar seed={props.seed ?? name()} size={28} class="typing-avatar" state="typing" />}
      </Show>
      {/* One-line bubble: the strut is a text-base line, so the height is a
          message bubble's. Two dots, then the typist's own bird pecking at a laptop. */}
      <div ref={bubble} class="typing-bubble" aria-hidden="true">
        <span class="typing-strut">&#8203;</span>
        <For each={[0, 1]}>{() => <span class="typing-dot" />}</For>
        <Bird slug={props.seed ?? props.typists[0] ?? "kiko"} state={birdState()} size={20} class="typing-bird" />
      </div>
      <Show when={props.doing && props.doing !== "writing a reply" ? props.doing : undefined}>
        {(doing) => (
          <span class="typing-doing" data-component="typing-doing" aria-hidden="true">
            {doing()}
          </span>
        )}
      </Show>
      <span class="typing-sr" role="status" aria-live="polite" aria-atomic="true">
        {announced()}
      </span>
    </div>
  );
}
