import { getThemeColorsForAppearance } from "./shared";
import {
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
  type ThemePreferenceMode,
} from "./parse";

export type { ThemeAppearance, ThemeColorRole, ThemeColors, ThemeDefinition };

/** role -> --kiko-* variable. t3 uses --app-theme-*; --kiko- avoids collision with legacy. */
export const APP_THEME_VARIABLES: Readonly<Record<ThemeColorRole, string>> = Object.fromEntries(
  THEME_COLOR_ROLES.map((role) => [
    role,
    `--kiko-${role.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`)}`,
  ]),
) as Record<ThemeColorRole, string>;

export function getThemeColorVariable(role: ThemeColorRole): string {
  return APP_THEME_VARIABLES[role];
}

export { getThemeColorsForAppearance as getThemeColorsForMode };

export function getThemeModes(theme: ThemeDefinition): ReadonlyArray<ThemeAppearance> {
  return (["light", "dark"] as const).filter(
    (mode) => getThemeColorsForAppearance(theme, mode) !== null,
  );
}

function themeRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.documentElement ?? null;
}

export const THEME_PREVIEW_ID = "__preview";

/** Paint a draft palette onto the live app without installing it. */
export function applyThemeColorPreview(colors: ThemeColors, appearance: ThemeAppearance): void {
  const root = themeRoot();
  if (!root?.style) return;
  root.dataset.themeId = THEME_PREVIEW_ID;
  root.classList.toggle("dark", appearance === "dark");
  for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
    root.style.setProperty(APP_THEME_VARIABLES[role], value);
  }
}

export function applyThemePalette(theme: ThemeDefinition, appearance?: ThemeAppearance): void {
  const root = themeRoot();
  if (!root?.style) return;
  root.dataset.themeId = theme.id;
  const mode = appearance ?? theme.appearance;
  const colors = getThemeColorsForAppearance(theme, mode) ?? theme.colors;
  root.classList.toggle("dark", mode === "dark");
  for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
    root.style.setProperty(APP_THEME_VARIABLES[role], value);
  }
}

export function clearThemePalette(): void {
  const root = themeRoot();
  if (!root?.style) return;
  delete root.dataset.themeId;
  for (const variable of Object.values(APP_THEME_VARIABLES)) {
    root.style.removeProperty(variable);
  }
}

/** Minimal appearance resolution: explicit mode wins, else follow system flag, else theme base. */
export function resolveThemeAppearance(
  theme: ThemeDefinition,
  systemDark: boolean,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
): ThemeAppearance {
  const mode = appearanceMode ?? (followSystem ? "system" : null);
  if (mode === "system") {
    const system: ThemeAppearance = systemDark ? "dark" : "light";
    return getThemeColorsForAppearance(theme, system) === null ? theme.appearance : system;
  }
  if (mode === "light" || mode === "dark") {
    return getThemeColorsForAppearance(theme, mode) === null ? theme.appearance : mode;
  }
  return theme.appearance;
}
