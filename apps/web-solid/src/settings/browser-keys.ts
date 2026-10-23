import { formatForDisplay, normalizeHotkey, parseHotkey } from "@tanstack/solid-hotkeys"
import type { Command } from "../commands/registry"

export type Platform = "mac" | "windows" | "linux"

export interface BrowserKey {
  action: string
  kept: boolean
}

type Entry = readonly [key: string, action: string, kept: boolean, only?: readonly Platform[]]

const TABS = Array.from(
  { length: 9 },
  (_, i) => [i + 1, i === 8 ? "Go to the last tab" : `Go to tab ${i + 1}`] as const,
)

const TABLE: readonly Entry[] = [
  ["Mod+N", "New window", true],
  ["Mod+Shift+N", "New private window", true],
  ["Mod+T", "New tab", true],
  ["Mod+Shift+T", "Reopen closed tab", true],
  ["Mod+W", "Close tab", true],
  ["Mod+Shift+W", "Close window", true],
  ["Control+Tab", "Next tab", true],
  ["Control+Shift+Tab", "Previous tab", true],
  ["Meta+Q", "Quit", true, ["mac"]],
  ["Meta+H", "Hide the app", true, ["mac"]],
  ["Meta+M", "Minimize", true, ["mac"]],
  ["Meta+Tab", "Switch apps", true, ["mac"]],
  ["Meta+Space", "Spotlight", true, ["mac"]],
  ["Meta+Shift+3", "Screenshot", true, ["mac"]],
  ["Meta+Shift+4", "Screenshot", true, ["mac"]],
  ["Meta+Shift+5", "Screenshot", true, ["mac"]],
  ["Alt+F4", "Close window", true, ["windows", "linux"]],
  ["Alt+Tab", "Switch apps", true, ["windows", "linux"]],
  ...TABS.map(([n, action]): Entry => [`Mod+${n}`, action, false]),
  ...TABS.map(([n, action]): Entry => [`Alt+${n}`, action, false, ["linux"]]),
  ["Mod+L", "Address bar", false],
  ["Mod+R", "Reload", false],
  ["Mod+Shift+R", "Reload", false],
  ["F5", "Reload", false, ["windows", "linux"]],
  ["Mod+D", "Bookmark this page", false],
  ["Mod+F", "Find in page", false],
  ["Mod+P", "Print", false],
  ["Mod+S", "Save page", false],
  ["Mod+J", "Downloads", false, ["windows", "linux"]],
  ["Mod+H", "History", false, ["windows", "linux"]],
  ["Mod+Y", "History", false, ["mac"]],
  ["Mod+Shift+I", "Developer tools", false],
  ["Mod+Alt+I", "Developer tools", false, ["mac"]],
  ["F12", "Developer tools", false],
  ["Mod+Shift+M", "Switch profile", false],
  ["Mod+Shift+B", "Bookmarks bar", false],
  ["Mod+Shift+Delete", "Clear browsing data", false],
  ["Alt+ArrowLeft", "Back", false, ["windows", "linux"]],
  ["Alt+ArrowRight", "Forward", false, ["windows", "linux"]],
  ["Mod+[", "Back", false, ["mac"]],
  ["Mod+]", "Forward", false, ["mac"]],
]

const canonical = (key: string, platform: Platform): string => {
  try {
    return normalizeHotkey(key, platform)
  } catch {
    return key
  }
}

export function browserKey(key: string, platform: Platform): BrowserKey | undefined {
  const wanted = canonical(key, platform)
  const hit = TABLE.find(([k, , , only]) => (!only || only.includes(platform)) && canonical(k, platform) === wanted)
  return hit && { action: hit[1], kept: hit[2] }
}

export function sameKey(a: string, b: string, platform: Platform): boolean {
  return canonical(a, platform) === canonical(b, platform)
}

export function refusal(command: Pick<Command, "global">, key: string, platform: Platform): string | undefined {
  const claimed = browserKey(key, platform)
  if (claimed?.kept) return `Kiko never gets ${formatForDisplay(key, { platform })}. It always means ${claimed.action}.`
  const parsed = parseHotkey(key, platform)
  const bare = !parsed.ctrl && !parsed.alt && !parsed.meta && !/^F\d+$/.test(parsed.key ?? "")
  if (command.global && bare) return "This shortcut also works while you type, so it needs Ctrl, Alt, or ⌘."
  return undefined
}
