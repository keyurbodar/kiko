import { For, Show } from "solid-js"
import type { Token, TokenGroup } from "../tokens"
import { TokenGlyph } from "./chip"

export default function TokenPopover(props: {
  id: string
  label: string
  groups: TokenGroup[]
  activeID?: string
  left: number
  onActiveChange: (item: Token) => void
  onSelect: (item: Token) => void
}) {
  const ids = () => props.groups.flatMap((group) => group.items.map((item) => item.id))
  return (
    <div
      class="composer-popover no-scrollbar"
      data-component="prompt-input-v2-popover"
      style={{ "--popover-left": `${props.left}px` }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div id={props.id} role="listbox" aria-label={props.label}>
        <For each={props.groups}>
          {(group) => (
            <div role="group" aria-label={group.label || undefined} data-group={group.kind}>
              <Show when={group.label} fallback={<div class="composer-popover-rule" aria-hidden="true" />}>
                <div class="composer-popover-group" aria-hidden="true">
                  {group.label}
                </div>
              </Show>
              <For each={group.items}>
                {(item) => (
                  <div
                    id={`${props.id}-opt-${ids().indexOf(item.id)}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={props.activeID === item.id}
                    data-suggestion-id={item.id}
                    data-kind={item.kind}
                    class="composer-popover-row"
                    data-active={props.activeID === item.id ? "" : undefined}
                    onPointerMove={() => props.onActiveChange(item)}
                    onClick={() => props.onSelect(item)}
                  >
                    <span class="composer-popover-icon">
                      <TokenGlyph token={item} size={14} />
                    </span>
                    <span class="composer-popover-label">{item.title}</span>
                    <span class="composer-popover-hint">{item.hint}</span>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
