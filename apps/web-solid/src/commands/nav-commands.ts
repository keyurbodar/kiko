import { SETTINGS_SECTIONS } from "../settings/sections"
import type { Choice, Command } from "./registry"

/*
 * Commands that move around the app and open settings. Every screen the rail reaches has one, and
 * so does the first-run path: "Models and providers" under Settings connects one, two keystrokes from anywhere.
 * The table takes what it acts on, so it tests without a router.
 */
export function navCommands(deps: {
  go: (href: string) => void
  signOut: () => void
  chooseModel: () => void
  /** Opens the palette on one command's submenu. */
  openView: (id: string) => void
  /** True when the agent the composer's model chip targets can reason. */
  canReason: () => boolean
  reasoningChoices: () => Choice[]
}): Command[] {
  return [
    { id: "go.chat", title: "Chats", group: "go", icon: "chat", global: true, run: () => deps.go("/chat") },
    { id: "settings.open", title: "Open settings", group: "settings", icon: "settings", shortcut: "Mod+,", global: true, run: () => deps.go("/settings") },
    { id: "settings.models", title: "Models and providers", group: "settings", icon: "model", run: () => deps.go("/settings/models") },
    {
      id: "settings.pages",
      title: "Open settings page…",
      group: "settings",
      icon: "settings",
      placeholder: "Open settings page…",
      submenu: () => SETTINGS_SECTIONS.map((s) => ({ id: s.id, title: s.label, icon: "settings", run: () => deps.go(`/settings/${s.id}`) })),
      run: () => deps.openView("settings.pages"),
    },
    { id: "chat.reasoning", title: "Reasoning…", group: "chat", icon: "model", placeholder: "Reasoning…", when: deps.canReason, submenu: deps.reasoningChoices, run: () => deps.openView("chat.reasoning") },
    { id: "chat.model", title: "Choose model", group: "chat", icon: "model", shortcut: "Mod+Shift+M", global: true, run: deps.chooseModel },
    { id: "account.sign-out", title: "Sign out", group: "account", icon: "signout", run: deps.signOut },
  ]
}
