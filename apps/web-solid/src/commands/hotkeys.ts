import { createHotkey, formatForDisplay, type RegisterableHotkey } from "@tanstack/solid-hotkeys"
import { createMemo, mapArray } from "solid-js"
import { commands, isEnabled, keysOf, type Command } from "./registry"

export function hotkeyOptions(command: Command) {
  return {
    ignoreInputs: !command.global,
    enabled: isEnabled(command),
    conflictBehavior: "allow" as const,
    preventDefault: !command.passive,
    stopPropagation: !command.passive,
  }
}

export function bindCommandHotkeys(): void {
  const bound = createMemo(() => commands().flatMap((c) => keysOf(c).map((key) => ({ command: c, key }))))
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
  createMemo(() => owners())
}

export function displayShortcut(shortcut: string): string {
  return formatForDisplay(shortcut as RegisterableHotkey)
}
