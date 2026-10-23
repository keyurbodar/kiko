import { ErrorBoundary, type JSX } from "solid-js"

export function PlainFallback(props: { text: string; children: JSX.Element }): JSX.Element {
  return (
    <ErrorBoundary fallback={<span class="whitespace-pre-wrap">{props.text}</span>}>{props.children}</ErrorBoundary>
  )
}
