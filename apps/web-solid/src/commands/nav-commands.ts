import type { Command } from "./registry"

/*
 * Commands that move around the app and open settings. Every screen the rail reaches has one, and
 * so does the first-run path: "Models and providers" under Settings connects one, two keystrokes from anywhere.
 * The table takes what it acts on, so it tests without a router.
 */
export function navCommands(deps: {
  go: (href: string) => void
  signOut: () => void
  chooseModel: () => void
}): Command[] {
  return [
    { id: "go.chat", title: "Chats", group: "go", icon: "chat", global: true, run: () => deps.go("/chat") },
    { id: "settings.open", title: "Open settings", group: "settings", icon: "settings", shortcut: "Mod+,", global: true, run: () => deps.go("/settings") },
    { id: "settings.models", title: "Models and providers", group: "settings", icon: "model", run: () => deps.go("/settings/models") },
    { id: "settings.tools", title: "Tools", group: "settings", icon: "integrations", run: () => deps.go("/settings/tools") },
    { id: "settings.appearance", title: "Appearance", group: "settings", icon: "appearance", run: () => deps.go("/settings/appearance") },
    { id: "settings.general", title: "General", group: "settings", icon: "account", run: () => deps.go("/settings/general") },
    { id: "settings.account", title: "Account", group: "settings", icon: "account", run: () => deps.go("/settings/account") },
    { id: "chat.model", title: "Choose model", group: "chat", icon: "model", shortcut: "Mod+Shift+M", global: true, run: deps.chooseModel },
    { id: "account.sign-out", title: "Sign out", group: "account", icon: "signout", run: deps.signOut },
  ]
}
