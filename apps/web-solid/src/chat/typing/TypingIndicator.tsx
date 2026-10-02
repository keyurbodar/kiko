import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { describe } from "./create-typing-presence";
import { CROSSFADE_SPRING, SURFACE_SPRING } from "./spring";
import "./typing.css";

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const LEAVE = "cubic-bezier(0.4, 0, 1, 1)";
const SEND_MS = 340;

export interface TypingIndicatorProps {
  typists: string[];
  sending?: boolean;
  max?: number;
  size?: number;
  showLabel?: boolean;
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
  const size = () => props.size ?? 34;
  const max = () => props.max ?? 2;
  const label = createMemo(() => describe(props.typists, max()));
  const active = () => props.typists.length > 0;

  let bubble!: HTMLDivElement;
  let labelWrap: HTMLSpanElement | undefined;
  let labelEl: HTMLSpanElement | undefined;
  const bubbleAnim = { current: null as Animation | null };
  const labelAnim = { current: null as Animation | null };

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

  // The label: slide in from 7px below, slide out 7px up.
  createEffect(
    on(label, (text, prevText) => {
      if (!labelWrap || !labelEl) return;
      const el = labelEl;
      const motion = !reduced();
      if (prevText) {
        const ghost = el.cloneNode(true) as HTMLSpanElement;
        ghost.setAttribute("aria-hidden", "true");
        labelWrap.appendChild(ghost);
        const out = ghost.animate(
          motion
            ? [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-7px)" }]
            : [{ opacity: 1 }, { opacity: 0 }],
          { duration: motion ? 200 : 0, easing: EASE, fill: "forwards" },
        );
        out.onfinish = () => ghost.remove();
      }
      el.textContent = text;
      if (!text) {
        labelAnim.current?.cancel();
        el.style.opacity = "0";
        return;
      }
      labelAnim.current?.cancel();
      labelAnim.current = el.animate(
        motion
          ? [{ opacity: 0, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }]
          : [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: motion ? CROSSFADE_SPRING.duration : 0,
          easing: motion ? CROSSFADE_SPRING.easing : "linear",
          fill: "forwards",
        },
      );
    }),
  );

  // The label hides while the message is sending.
  createEffect(() => {
    if (labelEl) labelEl.style.visibility = props.sending ? "hidden" : "visible";
  });

  // The screen reader text trails the visible label.
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
    if (label() && labelEl) labelEl.textContent = label();
    if (active()) play(bubble, bubbleAnim, [{ opacity: 1, transform: "scale(1)" }], { duration: 0 });
  });

  const width = () => Math.round(size() * 2);
  const dot = () => Math.round(size() * 0.23);
  const gap = () => Math.round(size() * 0.15);
  const radius = () => Math.round(size() * 0.47);

  return (
    <div class={`typing ${props.class ?? ""}`} style={{ height: `${size()}px` }}>
      <div class="typing-slot" style={{ width: `${width()}px`, height: `${size()}px` }}>
        <div
          ref={bubble}
          class="typing-bubble"
          aria-hidden="true"
          style={{ "border-radius": `${radius()}px`, gap: `${gap()}px` }}
        >
          <For each={[0, 1, 2]}>{() => <span class="typing-dot" style={{ width: `${dot()}px`, height: `${dot()}px` }} />}</For>
        </div>
      </div>

      <Show when={props.showLabel !== false}>
        <span ref={labelWrap} class="typing-label-wrap" style={{ height: `${size() * 0.6}px` }}>
          <span ref={labelEl} class="typing-label" aria-hidden="true" />
        </span>
      </Show>

      <span class="typing-sr" role="status" aria-live="polite" aria-atomic="true">
        {announced()}
      </span>
    </div>
  );
}
