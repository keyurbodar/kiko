/*
 * Writes src/app/first-run/mural.gen.ts: the welcome page's backdrop, a drawing sheet. A fine grid with
 * a crosshair at every fifth line, Kiko drawn as a construction figure (the dome's ellipse and axes, the
 * leaves' angles, the body's measures, three callouts), and a detail view that magnifies a leaf. The
 * figure is @kiko/avatar/outline's Kiko, so it is the avatar's own geometry and moves when the avatar
 * does: run `bun scripts/gen-mural.ts` in apps/web-solid after a change. A test fails while the file is
 * out of date.
 *
 * Each part is the inside of an inline <svg> in backdrop.tsx, so it is drawn sharp at any pixel density
 * in the theme's colors (first-run.css). Shapes are paper and lines ink. Kiko's outline carries
 * pathLength="1" so the page can draw it in.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { leafOutline, outline } from "@kiko/avatar/outline"

export const MURAL_FILE = join(import.meta.dir, "../src/app/first-run/mural.gen.ts")

/** Pixels per avatar unit in the figure, and the figure's view in avatar units. */
export const SCALE = 2.7
const VIEW = [-10, -6, 162, 126] as const
/** The sheet's grid: a cell, a crosshair every fifth line, over an area wider and taller than a screen. */
const CELL = 48
const MAJOR = 5
const SHEET_W = 3840
const SHEET_H = 2400

const f = (n: number) => +n.toFixed(2)
const u = (px: number) => f(px / SCALE)
const label = (x: number, y: number, text: string, anchor = "middle", turn = 0) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-size="${u(10.5)}" stroke-width="${u(3)}"${turn ? ` transform="rotate(${turn} ${f(x)} ${f(y)})"` : ""}>${text}</text>`
/** A direction `a` degrees from upright, clockwise. */
const dir = (a: number) => [Math.sin((a * Math.PI) / 180), -Math.cos((a * Math.PI) / 180)] as const

function sheet(): string {
  let lines = ""
  for (let x = 0; x <= SHEET_W; x += CELL) lines += `M${x + 0.5} 0V${SHEET_H}`
  for (let y = 0; y <= SHEET_H; y += CELL) lines += `M0 ${y + 0.5}H${SHEET_W}`
  let marks = ""
  for (let x = 0; x <= SHEET_W; x += CELL * MAJOR) for (let y = 0; y <= SHEET_H; y += CELL * MAJOR) marks += `M${x - 4.5} ${y + 0.5}h10M${x + 0.5} ${y - 4.5}v10`
  return `<path class="welcome-rule" d="${lines}"/><path class="welcome-line" d="${marks}"/>`
}

/** Kiko, happy, as the logo is: the leaves stand at 36 and 20 degrees from upright. */
const LEAVES = [
  { x: 56.4, y: 51, angle: -36, length: 37.5 },
  { x: 71.3, y: 51.7, angle: 20, length: 40 },
]

function figure(): string {
  // Construction: the dome's ellipse and its axes, the ground, and each leaf's axis against upright.
  let build = `<ellipse cx="58" cy="82.5" rx="39" ry="36.5" class="welcome-dash"/><path d="M58 2V117M6 82.5H110" class="welcome-axis"/><path d="M-2 100H116"/>`
  let notes = ""
  for (const l of LEAVES) {
    const [dx, dy] = dir(l.angle)
    const r = l.length + 7
    build += `<path d="M${l.x} ${l.y}L${f(l.x + dx * (l.length + 12))} ${f(l.y + dy * (l.length + 12))}M${l.x} ${f(l.y - l.length + 6)}V${f(l.y - r - 4)}" class="welcome-dash"/>`
    notes += `<path d="M${l.x} ${f(l.y - r)}A${r} ${r} 0 0 ${l.angle < 0 ? 0 : 1} ${f(l.x + dx * r)} ${f(l.y + dy * r)}"/>`
    const [mx, my] = dir(l.angle / 2)
    notes += label(l.x + mx * (r + 5), l.y + my * (r + 5) + 1, `${Math.abs(l.angle)}°`)
  }
  // Measures: the width under the ground and the height on the left, with architect's ticks.
  const tick = (x: number, y: number) => `M${f(x - 1.4)} ${f(y + 1.4)}L${f(x + 1.4)} ${f(y - 1.4)}`
  notes += `<path d="M19.4 103V116M96.6 103V116M19.4 113H96.6${tick(19.4, 113)}${tick(96.6, 113)}M44 46.6H-1M2 46.6V100${tick(2, 46.6)}${tick(2, 100)}"/>`
  notes += label(58, 110.6, "78") + label(-1.4, 73.3, "54", "middle", -90)
  // Callouts, each with a dot on its part, and the ring around the leaf that Detail A magnifies.
  const callout = (px: number, py: number, ex: number, ey: number, text: string) =>
    `<path d="M${px} ${py}L${ex} ${ey}H${ex + 6}"/><circle cx="${px}" cy="${py}" r="${u(2)}" class="welcome-dot"/>${label(ex + 7.5, ey + 1.1, text, "start")}`
  notes += callout(84.5, 74.4, 108, 66, "Berry eyes") + callout(80.6, 31, 104, 24, "Camellia leaf") + callout(93.5, 90, 108, 96, "Mochi body")
  notes += `<circle cx="78" cy="31" r="15" class="welcome-dash"/>${label(91, 15, "A", "start")}`
  // Kiko's outline draws itself in: every stroke is one unit long.
  const kiko = outline({ leaf: "camellia", mood: "happy", blush: true }).replace(/<(path|circle|ellipse) /g, `<$1 pathLength="1" `)
  return `<g class="welcome-build">${build}</g><g class="welcome-kiko" stroke-width="${u(1.3)}">${kiko}</g><g class="welcome-notes">${notes}</g>`
}

/** Detail A: Kiko's near leaf at twice the figure's size, in a ring, with its axis. */
function detail(): string {
  const k = 4.4, [dx, dy] = dir(20)
  return `<circle r="104" class="welcome-dash"/><g class="welcome-kiko" transform="translate(-6 78) rotate(20) scale(${k})" stroke-width="${f(1.3 / k)}">${leafOutline("camellia", 40).replace(/<path /g, `<path pathLength="1" `)}</g>
<path d="M-6 78L${f(-6 + dx * 196)} ${f(78 + dy * 196)}" class="welcome-dash"/><g class="welcome-notes"><path d="M58 -70L84 -96H96"/><text x="100" y="-92">Detail A</text><text x="100" y="-78">6:1</text></g>`
}

export const muralFile = () =>
  [
    "// Generated by apps/web-solid/scripts/gen-mural.ts from @kiko/avatar/outline. Run it after a change; do not edit.",
    `export const FIGURE_VIEW = ${JSON.stringify(VIEW.join(" "))}`,
    `export const FIGURE_SIZE = ${JSON.stringify([f(VIEW[2] * SCALE), f(VIEW[3] * SCALE)])} as const`,
    `export const SHEET = ${JSON.stringify(sheet())}`,
    `export const FIGURE = ${JSON.stringify(figure())}`,
    `export const DETAIL = ${JSON.stringify(detail())}`,
    "",
  ].join("\n")

if (import.meta.main) {
  writeFileSync(MURAL_FILE, muralFile())
  console.log(`wrote ${MURAL_FILE}`)
}
