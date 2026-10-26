import { EmptyArt } from "../components/empty-art"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, PlusIcon } from "@kiko/ui/icons"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "../lib/dialog"
import { AppDetail, type AppId, APPS, appState, useIntegrations } from "../settings/integrations"
import "./page-ui.css"

export type Scope = "yours" | "discover"

export function AppsTab(props: { query: string; scope: Scope }) {
  const api = useIntegrations()
  const [openId, setOpenId] = createSignal<AppId | null>(null)
  const rows = createMemo(() => {
    const words = props.query.toLowerCase().split(/\s+/).filter(Boolean)
    return (Object.keys(APPS) as AppId[])
      .map((id) => ({ id, app: APPS[id], state: appState(api, id) }))
      .filter(
        (r) =>
          (props.scope === "discover" || r.state !== "empty") &&
          words.every((w) => `${r.app.name} ${r.app.description}`.toLowerCase().includes(w)),
      )
  })
  return (
    <div class="flex flex-col gap-4" data-component="apps-tab">
      <div class="grid grid-cols-1 gap-3 @min-[720px]/page:grid-cols-2" data-component="tools-list">
        <For
          each={rows()}
          fallback={
            <div
              class="col-span-full flex flex-col items-center gap-2 px-6 py-12 text-center"
              data-component="apps-empty"
            >
              <EmptyArt name={props.scope === "yours" && !props.query ? "plug" : "search"} size={140} />
              <p class="type-ui text-fg2">
                {props.scope === "yours" && !props.query ? "No apps connected." : "Nothing matches."}
              </p>
              <Show when={props.scope === "yours" && !props.query}>
                <p class="type-label max-w-[280px] text-fg3">
                  Connect Gmail or Calendar so your agents can help with real things.
                </p>
              </Show>
            </div>
          }
        >
          {(row) => {
            const connected = () => row.state === "connected"
            return (
              <button
                type="button"
                class="group flex min-w-0 cursor-pointer items-start gap-3.5 page-card rounded-card bg-panel p-4 text-left outline-none transition-[background-color,transform] duration-(--dur-hover) hover:bg-raise active:scale-[0.99] focus-visible:bg-raise"
                data-tool={`app:${row.id}`}
                onClick={() => setOpenId(row.id)}
              >
                <span class="grid size-12 shrink-0 place-items-center rounded-tile bg-raise text-fg transition-colors duration-(--dur-hover) group-hover:bg-active [&_svg]:size-7">
                  <row.app.icon />
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="type-ui truncate font-semibold text-fg">{row.app.name}</span>
                  <span class="type-row line-clamp-2 text-fg3">{row.app.description}</span>
                  <Show when={row.state === "broken"}>
                    <span class="type-label mt-1 text-bad">Key rejected</span>
                  </Show>
                </span>
                <span
                  class="grid size-8 shrink-0 place-items-center rounded-control bg-raise text-fg2 transition-colors duration-(--dur-hover) group-hover:bg-active"
                  aria-hidden="true"
                >
                  <Show when={connected()} fallback={<RemixIcon icon={PlusIcon} size={16} class="page-swap" />}>
                    <RemixIcon icon={CheckIcon} size={16} class="page-swap text-ok" />
                  </Show>
                </span>
              </button>
            )
          }}
        </For>
      </div>
      <Dialog
        open={openId() !== null}
        onClose={() => setOpenId(null)}
        title={openId() ? APPS[openId()!].name : ""}
        description={openId() ? APPS[openId()!].description : undefined}
        size="md"
        data-component="tool-detail"
      >
        <Show when={openId()} keyed>
          {(id) => <AppDetail id={id} api={api} />}
        </Show>
      </Dialog>
    </div>
  )
}
