import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, ReasoningIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { defaultThinking, THINKING_LABELS, type ThinkingLevel } from "@kiko/protocol"
import { For, Show } from "solid-js"
import { cn } from "../lib/cn"
import { canReason } from "./agent-model"
import "./reasoning-menu.css"

const choices = (levels: readonly ThinkingLevel[]) => levels.filter((level) => level !== "off" || levels.length > 1)

function LevelLabel(props: { level: ThinkingLevel; levels: readonly ThinkingLevel[] }) {
  return (
    <>
      <span>{THINKING_LABELS[props.level]}</span>
      <Show when={props.level === defaultThinking(props.levels)}>
        <span class="reasoning-default">Default</span>
      </Show>
    </>
  )
}

export function ReasoningChoices(props: {
  levels: readonly ThinkingLevel[]
  value: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
}) {
  return (
    <div class="reasoning-choices" role="radiogroup" aria-label="Reasoning">
      <For each={choices(props.levels)}>
        {(level) => (
          <button
            type="button"
            role="radio"
            class="reasoning-choice"
            aria-checked={level === props.value}
            data-level={level}
            onClick={() => level !== props.value && props.onChange(level)}
          >
            <LevelLabel level={level} levels={props.levels} />
          </button>
        )}
      </For>
    </div>
  )
}

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
      <MenuV2 gutter={8} placement={props.placement ?? "top-start"}>
        <MenuV2.Trigger
          class={cn(
            "reasoning-trigger flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2 text-label text-fg2 hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg",
            props.class,
          )}
          aria-label="Reasoning"
          title="Reasoning"
          data-component="reasoning-trigger"
        >
          <RemixIcon icon={ReasoningIcon} size={14} />
          <span class="reasoning-label">{THINKING_LABELS[value()]}</span>
          <RemixIcon icon={ChevronDownIcon} size={10} class="opacity-70" />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="min-w-52" data-component="reasoning-menu">
            <MenuV2.Group>
              <MenuV2.GroupLabel>Reasoning</MenuV2.GroupLabel>
              <MenuV2.RadioGroup
                value={value()}
                onChange={(next) => next !== value() && props.onChange(next as ThinkingLevel)}
              >
                <For each={choices(levels())}>
                  {(level) => (
                    <MenuV2.RadioItem value={level} closeOnSelect data-level={level}>
                      <span class="flex flex-1 items-center gap-2">
                        <LevelLabel level={level} levels={levels()} />
                      </span>
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
