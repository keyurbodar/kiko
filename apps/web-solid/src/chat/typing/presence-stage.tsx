import { onCleanup, onMount } from "solid-js";
import { BIRD_W, type Pixels } from "../../mascot/pixel/sprite";
import { runStage, type Stage } from "../../mascot/pixel/stage";
import type { Act } from "./action";

/*
 * The presence row's pixel stage: each working agent's bird acting out its current act. It
 * loads on its own, the first time an agent works, so the chat route does not carry it.
 */

export type Actor = { pixels: Pixels; act: Act };

const CELL = 3;
const ROWS = 13;
const GROUND = 12;
const SLOT = BIRD_W + 7;

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

export default function PresenceStage(props: { count: number; actors: () => Actor[]; sending: () => boolean }) {
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

