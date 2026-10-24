import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, ReasoningIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { defaultThinking, THINKING_LABELS, type ThinkingLevel } from "@kiko/protocol"
import { For, Show } from "solid-js"
import { cn } from "../lib/cn"
import { canReason } from "./agent-model"

export function ReasoningMenu(props: {
  levels: readonly ThinkingLevel[] | undefined
  value: ThinkingLevel | undefined
  onChange: (level: ThinkingLevel) => void
  class?: string
  placement?: "top-start" | "bottom-end"
}) {
  const levels = () => props.levels ?? []
  const value = () => props.value ?? defaultThinking(levels())
  return (
    <Show when={canReason(props.levels)}>
      <MenuV2 gutter={6} placement={props.placement ?? "top-start"}>
        <MenuV2.Trigger
          class={cn(
            "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-fg2 hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg",
            props.class,
          )}
          aria-label="Reasoning"
          title="Reasoning"
          data-component="reasoning-trigger"
        >
          <RemixIcon icon={ReasoningIcon} size={14} />
          <span>{THINKING_LABELS[value()]}</span>
          <RemixIcon icon={ChevronDownIcon} size={10} class="opacity-70" />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="z-[80] min-w-44" data-component="reasoning-menu">
            <MenuV2.Group>
              <MenuV2.GroupLabel class="px-2 pt-1.5 pb-1 text-xs font-medium text-fg2">Reasoning</MenuV2.GroupLabel>
              <MenuV2.RadioGroup value={value()} onChange={(level) => props.onChange(level as ThinkingLevel)}>
                <For each={levels()}>
                  {(level) => (
                    <MenuV2.RadioItem
                      value={level}
                      badge={level === defaultThinking(levels()) ? "Default" : undefined}
                      data-level={level}
                    >
                      {THINKING_LABELS[level]}
                    </MenuV2.RadioItem>
                  )}
                </For>
              </MenuV2.RadioGroup>
            </MenuV2.Group>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}
