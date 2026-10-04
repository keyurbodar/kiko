import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { birdFor } from "../../mascot/choices";
import { BIRD_W, birdPixels, type Pixels } from "../../mascot/pixel/sprite";
import { runStage, type Stage } from "../../mascot/pixel/stage";
import { type Act, actOf } from "./action";
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

const CELL = 3;
const ROWS = 13;
const GROUND = 12;
const SLOT = BIRD_W + 7;
const BIRDS = 3;

type Actor = { pixels: Pixels; act: Act };

/* A prop in front of the bird, as cells relative to the cell right of its beak. */
function drawAct(stage: Stage, act: Act, x: number, top: number, frame: number, ink: string, accent: string) {
  const front = x + BIRD_W;
  const twig = "oklch(0.55 0.08 60)";
  switch (act) {
    case "write": {
      // Notes rising from the beak.
      for (let i = 0; i < 2; i++) {
        const t = (frame + i * 9) % 18;
        stage.cell(front - 1 + (i % 2), top + 2 - Math.floor(t / 4), accent, 1 - t / 18);
      }
      return;
    }
    case "read":
    case "browse": {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) stage.cell(front + 1 + c, GROUND - 4 + r, ink, r === 0 && act === "browse" ? 0.9 : 0.55);
      if (act === "browse") for (let c = 0; c < 3; c++) stage.cell(front + 1 + c, GROUND - 4, accent);
      return;
    }
    case "build": {
      const pile = 1 + (Math.floor(frame / 20) % 4);
      for (let i = 0; i < pile; i++) stage.cell(front + 1 + (i % 3), GROUND - Math.floor(i / 3), twig);
      stage.cell(front - 1, top + 4, twig);
      stage.cell(front, top + 4, twig);
      return;
    }
    case "tool": {
      const ring = [[1, 0], [2, 1], [1, 2], [0, 1]] as const;
      const spin = Math.floor(frame / 4) % 4;
      ring.forEach(([c, r], i) => stage.cell(front + 1 + c, GROUND - 3 + r, ink, i === spin ? 1 : 0.4));
      stage.cell(front + 2, GROUND - 2, ink, 0.6);
      return;
    }
    case "helper": {
      const hop = Math.floor(frame / 6) % 2;
      for (const [c, r] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) stage.cell(front + 2 + c, GROUND - 1 + r - hop, "oklch(0.86 0.14 95)");
      stage.cell(front + 4, GROUND - 1 - hop, "#FFA14A");
      return;
    }
    case "remind": {
      const face = [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [1, 3], [2, 3]] as const;
      for (const [c, r] of face) stage.cell(front + 1 + c, GROUND - 4 + r, ink, 0.6);
      const hands = [[1, 1], [2, 1], [2, 2], [1, 2]] as const;
      const [hc, hr] = hands[Math.floor(frame / 8) % 4]!;
      stage.cell(front + 1 + hc, GROUND - 4 + hr, accent);
      return;
    }
    case "hatch": {
      const wobble = Math.floor(frame / 5) % 4 === 1 ? 1 : 0;
      for (const [c, r] of [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2], [1, 3]] as const) stage.cell(front + 1 + c + wobble, GROUND - 3 + r, "oklch(0.95 0.03 80)");
      return;
    }
  }
}

function Stage(props: { count: number; actors: () => Actor[]; sending: () => boolean }) {
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    let fly = 0;
    let frame = 0;
    const stop = runStage(canvas!, { cell: CELL, gap: 0, rows: ROWS, cols: props.count * SLOT - 2 }, {
      step(_stage, n) {
        frame = n;
        fly = props.sending() ? fly + 1 : 0;
      },
      draw(stage) {
        const ink = stage.token("--text-muted");
        const accent = stage.token("--accent");
        props.actors().forEach((a, i) => {
          const x = i * SLOT + (fly > 0 ? fly * 2 : 0);
          // Writing bobs, reading pecks, the rest stand still and work.
          const bob = a.act === "write" ? Math.floor(frame / 8) % 2 : a.act === "read" || a.act === "browse" ? (Math.floor(frame / 10) % 3 === 0 ? 1 : 0) : 0;
          const lift = fly > 0 ? Math.min(3, fly) : 0;
          const top = GROUND - a.pixels.h + 1 + bob - lift;
          stage.sprite(a.pixels, x, top, false);
          drawAct(stage, a.act, x, top, frame, ink, accent);
        });
      },
    });
    onCleanup(stop);
  });
  return <canvas ref={canvas} class="presence-stage" aria-hidden="true" />;
}

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
        {(count) => <Stage count={count} actors={actors} sending={() => props.sending === true} />}
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
