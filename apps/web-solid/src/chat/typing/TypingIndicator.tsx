import { createEffect, createMemo, createSignal, lazy, on, onCleanup, Show, Suspense } from "solid-js";
import { birdFor } from "../../mascot/choices";
import { birdPixels } from "../../mascot/pixel/sprite";
import { actOf } from "./action";
import type { Actor } from "./presence-stage";
import { describe } from "./create-typing-presence";
import "./typing.css";

/*
 * The presence row: who is working on your reply, and what they are doing, shown instead of
 * told. Each working agent is its own pixel bird acting out its current act (pecking at a
 * page, carrying a twig to a nest, turning a gear), beside one quiet line that says it in
 * words. It replaces the typing bubble: no dots, no box, one row under the last message.
 */

export interface TypingIndicatorProps {
  typists: string[];
  /** The typists' slugs, in the same order, so each bird is the agent's own. */
  seeds?: readonly string[];
  sending?: boolean;
  max?: number;
  /** What the first typist is doing, such as "editing /hello.html". */
  doing?: string;
  announceAfter?: number;
  class?: string;
}

const BIRDS = 3;
/** Mirrors the stage: 13 rows of 3px cells, and a slot of 17 cells per bird. */
const STAGE_H = 39;
const SLOT_W = 51;

// The pixel stage loads the first time an agent works; its spot is held so nothing shifts.
const PresenceStage = lazy(() => import("./presence-stage"));

export function TypingIndicator(props: TypingIndicatorProps) {
  const max = () => props.max ?? 2;
  const working = () => props.doing && props.doing !== "writing a reply" && props.typists.length === 1;
  const label = createMemo(() => (working() ? `${props.typists[0]} is ${props.doing}` : describe(props.typists, max())));
  const actors = createMemo<Actor[]>(() =>
    props.typists.slice(0, BIRDS).map((name, i) => ({
      pixels: birdPixels(birdFor(props.seeds?.[i] ?? name)),
      act: i === 0 ? actOf(props.doing) : "write",
    })),
  );

  // The screen reader text trails the typing state. It is the only label read out.
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

  return (
    <div class={`presence ${props.class ?? ""}`} data-component="typing-indicator" data-act={actors()[0]?.act}>
      {/* The canvas is as wide as the birds on it, so it is made again when that count changes. */}
      <Show when={actors().length} keyed>
        {(count) => (
          <Suspense fallback={<span class="block shrink-0" style={{ width: `${count * SLOT_W - 6}px`, height: `${STAGE_H}px` }} />}>
            <PresenceStage count={count} actors={actors} sending={() => props.sending === true} />
          </Suspense>
        )}
      </Show>
      <span class="presence-line" data-component="typing-doing" aria-hidden="true">
        {label()}
      </span>
      <span class="typing-sr" role="status" aria-live="polite" aria-atomic="true">
        {announced()}
      </span>
    </div>
  );
}
