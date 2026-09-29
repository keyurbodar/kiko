import { Icon } from "@kiko/ui/v2/icon"
import { TextInputV2 } from "@kiko/ui/v2/text-input-v2"
import { Show, type JSX } from "solid-js"

export function SearchField(props: {
  value: () => string
  onValue: (value: string) => void
  resultCount: () => number | undefined
}): JSX.Element {
  return (
    <div data-slot="sidebar-search" role="search">
      <TextInputV2
        value={props.value()}
        onInput={(event) => props.onValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || props.value().length === 0) return
          event.preventDefault()
          props.onValue("")
        }}
        placeholder="Search"
        aria-label="Search"
        leadingIcon={<Icon name="magnifying-glass" size="normal" />}
        showClearButton={props.value().length > 0}
        onClearClick={() => props.onValue("")}
      />
      <Show when={props.resultCount() !== undefined}>
        <span data-slot="sidebar-search-count">{props.resultCount()}</span>
      </Show>
    </div>
  )
}
