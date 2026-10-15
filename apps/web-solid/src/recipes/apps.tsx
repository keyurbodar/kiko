import type { RecipeApp } from "@kiko/protocol"
import { For, Show } from "solid-js"

export function RecipeApps(props: { apps: readonly RecipeApp[] }) {
  return <Show when={props.apps.length}>
    <ul class="flex flex-wrap gap-1.5" aria-label="Apps used through Composio">
      <For each={props.apps}>{(app) => <li title={app.connected === null ? "Connection unknown" : app.connected ? "Connected" : "Not connected"} class="rounded-md bg-control px-2 py-0.5 text-xs leading-5 text-muted-foreground">{app.name}</li>}</For>
    </ul>
  </Show>
}
