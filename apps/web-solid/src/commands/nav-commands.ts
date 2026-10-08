import type { Command } from "./registry"

/*
 * Commands that move around the app and open settings. Every screen the rail reaches has one, and
 * so does the first-run path: "Settings: Models and providers" connects one, two keystrokes from anywhere.
 * The table takes what it acts on, so it tests without a router.
 */
export function navCommands(deps: {
  go: (href: string) => void
  signOut: () => void
  chooseModel: () => void
}): Command[] {
  return [
    { id: "go.chat", title: "Go: Chats", group: "go", icon: "chat", shortcut: "Mod+Shift+C", global: true, run: () => deps.go("/chat") },
    { id: "settings.open", title: "Settings: Open", group: "settings", icon: "settings", shortcut: "Mod+,", global: true, run: () => deps.go("/settings") },
    { id: "settings.providers", title: "Settings: Providers", group: "settings", icon: "model", run: () => deps.go("/settings/providers") },
    { id: "settings.models", title: "Settings: Models", group: "settings", icon: "model", run: () => deps.go("/settings/models") },
    { id: "settings.integrations", title: "Settings: Integrations", group: "settings", icon: "integrations", run: () => deps.go("/settings/integrations") },
    { id: "settings.appearance", title: "Settings: Appearance", group: "settings", icon: "appearance", run: () => deps.go("/settings/appearance") },
    { id: "settings.account", title: "Settings: Account", group: "settings", icon: "account", run: () => deps.go("/settings/account") },
    { id: "chat.model", title: "Chat: Choose model", group: "chat", icon: "model", shortcut: "Mod+Shift+M", global: true, run: deps.chooseModel },
    { id: "account.sign-out", title: "Account: Sign out", group: "account", icon: "signout", run: deps.signOut },
  ]
}
