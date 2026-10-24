import { For } from "solid-js"

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

export function Odometer(props: { value: number }) {
  const digits = () => String(Math.max(0, Math.trunc(props.value))).split("")
  return (
    <span class="odometer" role="img" aria-label={String(props.value)}>
      <For each={digits()}>
        {(digit) => (
          <span class="odometer-digit" aria-hidden="true">
            <span class="odometer-reel" style={{ "--odometer-n": Number(digit) }}>
              <For each={DIGITS}>{(n) => <span>{n}</span>}</For>
            </span>
          </span>
        )}
      </For>
    </span>
  )
}
