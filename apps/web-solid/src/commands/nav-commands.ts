import type { Command } from "./registry"

/*
 * Commands that move around the app and open settings. Every screen the rail reaches has one, and
 * so does the first-run path: "settings: connect a provider" is two keystrokes from anywhere.
 * The table takes what it acts on, so it tests without a router.
 */
export function navCommands(deps: {
  go: (href: string) => void
  signOut: () => void
  chooseModel: () => void
}): Command[] {
  return [
    { id: "go.chat", title: "go: chat", group: "go", icon: "chat", run: () => deps.go("/chat") },
    { id: "go.files", title: "go: files", group: "go", icon: "files", run: () => deps.go("/files") },
    { id: "settings.open", title: "settings: open", group: "settings", icon: "settings", shortcut: "Mod+,", global: true, run: () => deps.go("/settings") },
    { id: "settings.providers", title: "settings: connect a provider", group: "settings", icon: "key", run: () => deps.go("/settings/providers") },
    { id: "settings.model", title: "settings: default model", group: "settings", icon: "model", run: () => deps.go("/settings/models") },
    { id: "settings.integrations", title: "settings: integrations", group: "settings", icon: "integrations", run: () => deps.go("/settings/integrations") },
    { id: "settings.appearance", title: "settings: appearance and theme", group: "settings", icon: "appearance", run: () => deps.go("/settings/appearance") },
    { id: "settings.account", title: "settings: account", group: "settings", icon: "account", run: () => deps.go("/settings/account") },
    { id: "chat.model", title: "chat: choose model", group: "chat", icon: "model", shortcut: "Mod+Shift+M", global: true, run: deps.chooseModel },
    { id: "account.sign-out", title: "account: sign out", group: "account", icon: "signout", run: deps.signOut },
  ]
}
