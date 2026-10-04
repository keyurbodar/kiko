import { onCleanup, onMount } from "solid-js"
import { birdFor } from "../choices"
import { BIRD_W, birdPixels, type Pixels } from "./sprite"
import { runStage } from "./stage"

/*
 * Small pixel moments for the quiet corners of the app, all on the shared stage:
 *   nothing  a bird looks left, then right, over an empty result
 *   nest     a bird asleep in its nest, a z drifting up, over an empty list
 *   cheer    the birds hop and seeds fall, once, when something first works
 * Each is a few dozen cells at 10 frames a second, and still under reduced motion.
 */

export type MomentKind = "nothing" | "nest" | "cheer"

const CELL = 3
const TWIG = "oklch(0.55 0.08 60)"
const SEEDS = ["#FFA14A", "#FFD84D", "#FF6F91", "#7DCB68"]

/** Closes the bird's eye: the eye cell takes the colour of the cell beside it. */
function asleep(p: Pixels): Pixels {
  const cells = p.cells.map((c, i) => (c === "#221A20" ? (p.cells[i - 1] ?? c) : c))
  return { ...p, cells }
}

export default function Moment(props: { kind: MomentKind; faces?: readonly string[] }) {
  let canvas: HTMLCanvasElement | undefined
  onMount(() => {
    const birds = (props.faces?.length ? props.faces : ["kiko"]).slice(0, props.kind === "cheer" ? 3 : 1).map((s) => birdPixels(birdFor(s)))
    const cols = props.kind === "cheer" ? birds.length * (BIRD_W + 3) + 4 : BIRD_W + 8
    const rows = 16
    const ground = rows - 2
    let frame = 0
    const confetti = Array.from({ length: 10 }, (_, i) => ({ x: (i * 7) % cols, y: -((i * 5) % 12), color: SEEDS[i % SEEDS.length]! }))
    const stop = runStage(canvas!, { cell: CELL, gap: 0, rows, cols, fps: props.kind === "cheer" ? 30 : 10 }, {
      step() {
        frame++
        if (props.kind === "cheer" && frame > 48) frame = 48
      },
      draw(stage) {
        const bird = birds[0]!
        const left = Math.floor((cols - BIRD_W) / 2)
        if (props.kind === "nothing") {
          const look = Math.floor(frame / 12) % 4
          stage.sprite(bird, left, ground - bird.h + 1, look === 2 || look === 3)
          if (look === 1 || look === 3) stage.cell(left + BIRD_W / 2, ground - bird.h - 1, stage.token("--text-faint"))
          return
        }
        if (props.kind === "nest") {
          const sleeping = asleep(bird)
          stage.sprite(sleeping, left, ground - bird.h + 2, false)
          for (let c = -1; c <= BIRD_W; c++) stage.cell(left + c, ground, TWIG, c === -1 || c === BIRD_W ? 0.6 : 1)
          for (let c = 0; c < BIRD_W; c += 2) stage.cell(left + c, ground + 1, TWIG, 0.7)
          const t = frame % 24
          stage.cell(left + BIRD_W + Math.floor(t / 8), ground - bird.h - Math.floor(t / 4), stage.token("--text-faint"), 1 - t / 24)
          return
        }
        const play = frame < 48
        birds.forEach((p, i) => {
          const hop = play ? Math.max(0, Math.round(Math.sin(((frame + i * 4) / 8) * Math.PI) * 3)) : 0
          stage.sprite(p, 2 + i * (BIRD_W + 3), ground - p.h + 1 - hop, false)
        })
        if (play) for (const c of confetti) stage.cell(c.x, c.y + Math.floor(frame / 2), c.color, 1 - frame / 48)
      },
    })
    onCleanup(stop)
  })
  return <canvas ref={canvas} class="block [image-rendering:pixelated]" data-component="pixel-moment" data-kind={props.kind} aria-hidden="true" />
}
