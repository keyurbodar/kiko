import { type JSX, Show, splitProps } from "solid-js"
import { CloseIcon, SearchIcon } from "../../icons.gen"
import { RemixIcon } from "../../components/remix-icon"
import "./search-field.css"

export type SearchFieldProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "value" | "onInput" | "ref"> & {
  value: string
  onValue: (value: string) => void
  ref?: (el: HTMLInputElement) => void
  size?: "normal" | "large"
  wrapClass?: string
}

export function SearchField(props: SearchFieldProps) {
  const [local, rest] = splitProps(props, ["value", "onValue", "ref", "size", "wrapClass", "onKeyDown", "type"])
  let input!: HTMLInputElement
  const clear = () => {
    local.onValue("")
    input.focus({ preventScroll: true })
  }
  const keyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (event) => {
    if (typeof local.onKeyDown === "function") local.onKeyDown(event)
    if (event.defaultPrevented || event.key !== "Escape" || !local.value) return
    event.preventDefault()
    event.stopPropagation()
    local.onValue("")
  }
  return (
    <label data-component="search-field" data-size={local.size ?? "normal"} class={local.wrapClass}>
      <RemixIcon icon={SearchIcon} size={14} data-slot="search-field-icon" />
      <input
        ref={(el) => {
          input = el
          local.ref?.(el)
        }}
        type={local.type ?? "search"}
        autocomplete="off"
        spellcheck={false}
        {...rest}
        value={local.value}
        onInput={(event) => local.onValue(event.currentTarget.value)}
        onKeyDown={keyDown}
      />
      <Show when={local.value}>
        <button
          type="button"
          tabindex={-1}
          aria-label="Clear search"
          data-slot="search-field-clear"
          onPointerDown={(event) => event.preventDefault()}
          onClick={clear}
        >
          <RemixIcon icon={CloseIcon} size={12} />
        </button>
      </Show>
    </label>
  )
}
