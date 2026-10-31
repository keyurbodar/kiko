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
              class="col-span-full mx-auto flex max-w-sm flex-col items-center gap-4 px-6 py-12 text-center"
              data-component="apps-empty"
            >
              <EmptyArt name={props.scope === "yours" && !props.query ? "plug" : "search"} size={96} />
              <p class="type-base text-secondary">
                {props.scope === "yours" && !props.query ? "No apps connected." : "Nothing matches."}
              </p>
              <Show when={props.scope === "yours" && !props.query}>
                <p class="type-sm -mt-3 text-tertiary">
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
                class="group flex min-w-0 cursor-pointer items-center gap-3 page-card rounded-xl bg-editor p-3 text-left outline-none transition-[background-color,transform] duration-(--duration-fast) hover:bg-quaternary-opaque-elevated active:scale-(--press-scale) focus-visible:bg-quaternary-opaque-elevated"
                data-tool={`app:${row.id}`}
                onClick={() => setOpenId(row.id)}
              >
                <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-tertiary text-primary [&_svg]:size-5">
                  <row.app.icon />
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="type-base truncate text-primary">{row.app.name}</span>
                  <span class="type-sm line-clamp-2 text-tertiary">{row.app.description}</span>
                  <Show when={row.state === "broken"}>
                    <span class="type-sm mt-1 text-danger">Key rejected</span>
                  </Show>
                </span>
                <span
                  class="grid size-6 shrink-0 place-items-center rounded-base icon-tertiary transition-colors duration-(--duration-fast) group-hover:icon-primary"
                  aria-hidden="true"
                >
                  <Show when={connected()} fallback={<RemixIcon icon={PlusIcon} size={14} class="page-swap" />}>
                    <RemixIcon icon={CheckIcon} size={14} class="page-swap text-success" />
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
