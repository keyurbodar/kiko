import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, PlusIcon } from "@kiko/ui/icons"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "../lib/dialog"
import { AppDetail, type AppId, APPS, appState, useIntegrations } from "../settings/integrations"
import { PageTabs } from "./page-ui"

type Scope = "yours" | "discover"

export function AppsTab(props: { query: string }) {
  const api = useIntegrations()
  const [scope, setScope] = createSignal<Scope>("discover")
  const [openId, setOpenId] = createSignal<AppId | null>(null)
  const rows = createMemo(() => {
    const words = props.query.toLowerCase().split(/\s+/).filter(Boolean)
    return (Object.keys(APPS) as AppId[])
      .map((id) => ({ id, app: APPS[id], state: appState(api, id) }))
      .filter(
        (r) =>
          (scope() === "discover" || r.state !== "empty") &&
          words.every((w) => `${r.app.name} ${r.app.description}`.toLowerCase().includes(w)),
      )
  })
  return (
    <div class="flex flex-col gap-4" data-component="apps-tab">
      <PageTabs<Scope>
        label="Apps"
        value={scope()}
        onChange={setScope}
        quiet
        options={[
          { value: "yours", label: "Yours" },
          { value: "discover", label: "Discover" },
        ]}
      />
      <div class="grid grid-cols-1 gap-3 @min-[720px]/page:grid-cols-2" data-component="tools-list">
        <For
          each={rows()}
          fallback={
            <p class="col-span-full px-6 py-14 text-center text-[15px] text-fg2">
              {scope() === "yours" && !props.query ? "No apps connected yet." : "Nothing matches."}
            </p>
          }
        >
          {(row) => {
            const connected = () => row.state === "connected"
            return (
              <button
                type="button"
                class="group flex min-w-0 cursor-pointer items-start gap-3.5 rounded-2xl bg-panel p-4 text-left outline-none transition-[background-color,transform] duration-[var(--dur-hover)] hover:bg-raise active:scale-[0.99] focus-visible:bg-raise"
                data-tool={`app:${row.id}`}
                onClick={() => setOpenId(row.id)}
              >
                <span class="grid size-12 shrink-0 place-items-center rounded-[13px] bg-raise text-fg2 transition-colors duration-[var(--dur-hover)] group-hover:bg-active [&_svg]:size-6">
                  <row.app.icon />
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-[15px] leading-6 font-semibold text-fg">{row.app.name}</span>
                  <span class="line-clamp-2 text-[13.5px] leading-5 text-fg3">{row.app.description}</span>
                  <Show when={row.state === "broken"}>
                    <span class="mt-1 text-[13px] text-bad">Key rejected</span>
                  </Show>
                </span>
                <span
                  class="grid size-8 shrink-0 place-items-center rounded-[9px] text-fg2 transition-colors duration-[var(--dur-hover)] group-hover:bg-active"
                  aria-hidden="true"
                >
                  <RemixIcon icon={connected() ? CheckIcon : PlusIcon} size={16} class={connected() ? "text-ok" : ""} />
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
