import { createHotkey, formatForDisplay, type RegisterableHotkey } from "@tanstack/solid-hotkeys"
import { createMemo, mapArray } from "solid-js"
import { commands, isEnabled, type Command } from "./registry"

/*
 * Binds every registered shortcut through `@tanstack/solid-hotkeys`. Call
 * `bindCommandHotkeys()` once, inside the shell. It follows the registry, so a
 * command that registers later gets its key and one that leaves loses it.
 *
 * Only a global command fires while a text field has focus. The library's own
 * default would let every Mod combo through, so the choice is made here.
 */
export function hotkeyOptions(command: Command) {
  return {
    ignoreInputs: !command.global,
    enabled: isEnabled(command),
    // Two commands may share a key while one is disabled.
    conflictBehavior: "allow" as const,
    preventDefault: !command.passive,
    stopPropagation: !command.passive,
  }
}

export function bindCommandHotkeys(): void {
  const bound = createMemo(() =>
    commands().flatMap((c) => [...(c.shortcut ? [{ command: c, key: c.shortcut }] : []), ...(c.alias ? [{ command: c, key: c.alias }] : [])]),
  )
  const owners = mapArray(bound, ({ command, key }) => {
    createHotkey(
      key as RegisterableHotkey,
      () => {
        if (isEnabled(command)) command.run()
      },
      () => hotkeyOptions(command),
    )
    return command.id
  })
  // mapArray is lazy, so read it once to create the owners.
  createMemo(() => owners())
}

/** `Mod+Shift+T` as `⌘⇧T` on a Mac and `Ctrl+Shift+T` elsewhere. */
export function displayShortcut(shortcut: string): string {
  return formatForDisplay(shortcut as RegisterableHotkey)
}
