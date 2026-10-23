import { closeSettings, openSettings, settingsSection } from "../settings/dialog-state"
import { SETTINGS_SECTIONS } from "../settings/sections"
import type { Choice, Command } from "./registry"

export function navCommands(deps: {
  go: (href: string) => void
  signOut: () => void
  chooseModel: () => void
  openView: (id: string) => void
  canReason: () => boolean
  reasoningChoices: () => Choice[]
  canChooseModel: () => boolean
}): Command[] {
  return [
    { id: "go.chat", title: "Chats", group: "go", icon: "chat", global: true, run: () => deps.go("/chat") },
    {
      id: "settings.open",
      title: "Open settings",
      group: "settings",
      icon: "settings",
      shortcut: "Mod+,",
      global: true,
      run: () => (settingsSection() ? closeSettings() : openSettings()),
    },
    {
      id: "settings.models",
      title: "Models and providers",
      group: "settings",
      icon: "model",
      run: () => openSettings("models"),
    },
    {
      id: "settings.pages",
      title: "Open settings page…",
      group: "settings",
      icon: "settings",
      placeholder: "Open settings page…",
      submenu: () =>
        SETTINGS_SECTIONS.map((s) => ({ id: s.id, title: s.label, icon: "settings", run: () => openSettings(s.id) })),
      run: () => deps.openView("settings.pages"),
    },
    {
      id: "chat.reasoning",
      title: "Reasoning…",
      group: "chat",
      icon: "model",
      placeholder: "Reasoning…",
      when: deps.canReason,
      submenu: deps.reasoningChoices,
      run: () => deps.openView("chat.reasoning"),
    },
    {
      id: "chat.model",
      title: "Choose model",
      group: "chat",
      icon: "model",
      shortcut: "Mod+Shift+M",
      global: true,
      when: deps.canChooseModel,
      run: deps.chooseModel,
    },
    { id: "account.sign-out", title: "Sign out", group: "account", icon: "signout", run: deps.signOut },
  ]
}
