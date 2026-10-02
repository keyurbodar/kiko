// The built-in themes. A user theme names one in `extends`. `kat-dark` is empty because the
// stylesheet already is kat dark. A test parses every preset with `parseTheme`, so a bad
// value here fails the build.

import type { Theme } from "../schema"

export const katDark: Theme = { version: 1, name: "kat dark", appearance: "dark" }

export const katLight: Theme = {
  version: 1,
  name: "kat light",
  appearance: "light",
  colors: {
    bg: "oklch(0.97 0.003 55)",
    sidebar: "oklch(0.9485 0.003 55)",
    subtle: "oklch(0.9356 0.005 55)",
    raised: "oklch(1 0.003 55)",
    menu: "oklch(1 0.003 55)",
    input: "oklch(0.94 0.004 55)",
    hover: "oklch(0.94 0.006 55)",
    selected: "oklch(0.91 0.012 55)",
    navActive: "oklch(0.88 0.02 55)",
    navHover: "oklch(0.93 0.008 55)",
    tooltip: "oklch(0.3 0.005 55)",
    tint: "oklch(0.9 0.005 55)",
    tintSubtle: "oklch(0.93 0.005 55)",
    tintStrong: "oklch(0.86 0.005 55)",
    scrollbar: "oklch(0.8 0.004 55)",
    scrollbarHover: "oklch(0.7 0.004 55)",
    text: "oklch(0.3248 0.012 55)",
    textMuted: "oklch(0.5906 0.02 55)",
    textFaint: "oklch(0.7118 0.015 55)",
    accent: "oklch(0.55 0.12 50)",
    accentFill: "oklch(0.6 0.13 50)",
    accentHover: "oklch(0.5 0.12 50)",
    onAccent: "oklch(0.98 0.008 55)",
    assistantBubble: "oklch(0.927 0.005 55)",
    userBubble: "oklch(0.499 0.08 48.4)",
    userBubbleDeep: "oklch(0.499 0.08 48.4)",
    userBubbleText: "oklch(0.97 0.008 55)",
    hairline: "oklch(0.88 0.005 55)",
    danger: "oklch(0.55 0.18 25)",
    success: "oklch(0.55 0.14 150)",
    gold: "oklch(0.62 0.14 80)",
    scrim: "oklch(0% 0 none / 0.4)",
  },
  tokens: {
    "--popover-shadow": "0 12px 40px oklch(0% 0 none / 0.18), 0 2px 6px oklch(0% 0 none / 0.08)",
    "--menu-shadow": "0 0 0 0.5px oklch(0% 0 none / 0.12), 0 10px 28px oklch(0% 0 none / 0.14)",
  },
}

/** Cool and dense. One hue turn does most of it. */
export const ink: Theme = {
  version: 1,
  name: "ink",
  extends: "kat-dark",
  colors: { hue: 250, userHue: 245, chroma: 1.6 },
  radius: { bubble: "12px", bubbleTight: "6px", small: "6px", row: "12px" },
  spacing: { bubblePadX: "10px", bubblePadY: "6px", runGap: "6px" },
  type: { baseSize: "13px" },
}

/** Warm light with a serif face and roomy bubbles. */
export const paper: Theme = {
  version: 1,
  name: "paper",
  extends: "kat-light",
  colors: {
    bg: "oklch(0.965 0.012 85)",
    sidebar: "oklch(0.935 0.014 85)",
    subtle: "oklch(0.945 0.014 85)",
    raised: "oklch(0.985 0.008 85)",
    assistantBubble: "oklch(0.925 0.016 85)",
    userBubble: "oklch(0.52 0.08 55)",
    userBubbleDeep: "oklch(0.46 0.08 55)",
    accent: "oklch(0.5 0.1 55)",
  },
  radius: { bubble: "22px" },
  spacing: { bubblePadX: "14px", bubblePadY: "9px", runGap: "12px" },
  type: { sans: "Charter, Georgia, ui-serif, serif", baseSize: "15px", lineHeight: 1.55 },
}

export const PRESETS: Record<string, Theme> = { "kat-dark": katDark, "kat-light": katLight, ink, paper }

export const presetFor = (id: string): Theme | undefined => PRESETS[id]
