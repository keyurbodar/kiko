// Ported from t3code (MIT): apps/web/src/components/settings/ThemePreviewCircles.tsx and
// ThemeWireframe.tsx. The wireframe draws kiko instead: a sidebar, bubbles and the composer.
import { For, type JSX } from "solid-js"
import { colorsForMode, defaultColors, themeModes, type ThemeAppearance, type ThemeColors, type ThemeDefinition } from "./palette"

export type ThemeCard = { id: string | null; label: string; previews: Array<{ mode: ThemeAppearance; colors: ThemeColors }> }

/** t3code's stock palette, the look with no theme picked. */
export const DEFAULT_CARD: ThemeCard = {
  id: null,
  label: "default",
  previews: (["light", "dark"] as const).map((mode) => ({ mode, colors: defaultColors(mode) })),
}

export function themeCard(theme: ThemeDefinition): ThemeCard {
  return {
    id: theme.id,
    label: theme.label.toLowerCase(),
    previews: themeModes(theme).map((mode) => ({ mode, colors: colorsForMode(theme, mode) ?? theme.colors })),
  }
}

export const previewOf = (card: ThemeCard, mode: ThemeAppearance): ThemeColors =>
  (card.previews.find((p) => p.mode === mode) ?? card.previews[0]!).colors

const SPECS = {
  light: { baseTarget: "#ffffff", accent: [0.72, 0.22, 0.72, 0.28, 0.58], action: [0.18, 0.82, 0.45, 0.55] },
  dark: { baseTarget: "#09090b", accent: [0.28, 0.78, 0.62, 0.28, 0.58], action: [0.82, 0.18, 0.45, 0.55] },
} as const

/** A soft orb: the canvas carries light or dark, with an accent glow and a tint of the action color. */
export function ThemeOrb(props: { colors: ThemeColors; mode: ThemeAppearance }): JSX.Element {
  const style = (): JSX.CSSProperties => {
    const spec = SPECS[props.mode]
    const [ax, ay, mid, midAt, end] = spec.accent
    const [bx, by, start, stop] = spec.action
    const c = props.colors
    return {
      "background-color": `color-mix(in oklab, ${c.canvas} 80%, ${spec.baseTarget})`,
      "background-image": [
        `radial-gradient(circle at ${ax * 100}% ${ay * 100}% in oklab, ${c.accent} 0%, color-mix(in oklab, ${c.accent} ${mid * 100}%, transparent) ${midAt * 100}%, transparent ${end * 100}%)`,
        `radial-gradient(circle at ${bx * 100}% ${by * 100}% in oklab, color-mix(in oklab, ${c.messageAction} ${start * 100}%, transparent) 0%, transparent ${stop * 100}%)`,
      ].join(", "),
      filter: "blur(3px)",
      transform: "scale(1.1)",
    }
  }
  return (
    <span
      aria-hidden="true"
      class="relative block size-14 shrink-0 overflow-hidden rounded-full"
      style={{
        "box-shadow":
          props.mode === "dark"
            ? "0 0 0 2px var(--bg), inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)"
            : "0 0 0 2px var(--bg), inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)",
      }}
    >
      <span class="absolute inset-0 rounded-full" style={style()} />
    </span>
  )
}

/** A miniature of kiko: the sidebar, a short conversation in bubbles, and the composer. */
function WireframePane(props: { colors: ThemeColors; clip?: "left" | "right" }): JSX.Element {
  const line = "rgb(127 127 127 / 0.25)"
  const c = () => props.colors
  return (
    <span
      class="absolute inset-0"
      style={
        props.clip
          ? {
              "clip-path":
                props.clip === "left"
                  ? "polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)"
                  : "polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)",
            }
          : undefined
      }
    >
      <span class="absolute inset-0" style={{ "background-color": c().canvas }} />
      <span class="absolute inset-y-0 left-0 w-[22%]" style={{ "background-color": c().sidebar, "box-shadow": `inset -1px 0 0 ${line}` }} />
      <span class="absolute top-[8%] left-[3%] h-[8%] w-[16%] rounded-md" style={{ "background-color": c().surface, "box-shadow": `inset 0 0 0 1px ${line}` }} />
      <span class="absolute top-[22%] left-[3%] h-[7%] w-[16%] rounded-md" style={{ "background-color": c().sidebarRowActive }} />
      <span class="absolute top-[32%] left-[3%] h-[7%] w-[16%] rounded-md" style={{ "background-color": c().sidebarRowHover }} />
      <span class="absolute top-[11%] right-[8%] h-[10%] w-[30%] rounded-lg" style={{ "background-color": c().messageSurface }} />
      <span class="absolute top-[27%] left-[27%] h-[10%] w-[34%] rounded-lg" style={{ "background-color": c().surface, "box-shadow": `inset 0 0 0 1px ${line}` }} />
      <span class="absolute top-[41%] left-[27%] h-[10%] w-[24%] rounded-lg" style={{ "background-color": c().surface, "box-shadow": `inset 0 0 0 1px ${line}` }} />
      <span
        class="absolute right-[6%] bottom-[8%] left-[26%] flex h-[15%] items-center justify-between rounded-md px-1"
        style={{ "background-color": c().surface, "box-shadow": `inset 0 0 0 1px ${line}` }}
      >
        <span class="block h-[26%] w-[34%] rounded-full" style={{ "background-color": line, opacity: 0.7 }} />
        <span class="block aspect-square h-[58%] rounded-full" style={{ "background-color": c().messageAction }} />
      </span>
    </span>
  )
}

export function ThemeWireframe(props: { panes: Array<{ colors: ThemeColors; clip?: "left" | "right" }> }): JSX.Element {
  return (
    <span aria-hidden="true" class="relative block h-[8.75rem] w-full overflow-hidden rounded-lg [box-shadow:inset_0_0_0_1px_var(--hairline)]">
      <For each={props.panes}>{(pane) => <WireframePane colors={pane.colors} clip={pane.clip} />}</For>
    </span>
  )
}
