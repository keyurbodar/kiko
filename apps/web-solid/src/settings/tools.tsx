import type { JSX } from "solid-js"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "../lib/dialog"
import { cn } from "../lib/cn"
import { AppDetail, type AppId, APPS, appState, useIntegrations } from "./integrations"
import { fieldClass, Segmented } from "./kit"

type Entry = { key: string; id: AppId; name: string; about: string; added: boolean; state: string }

type Filter = "all" | "added" | "available"

function Glyph(props: { entry: Entry }): JSX.Element {
  return (
    <span class="grid size-8 shrink-0 place-items-center rounded-row bg-active text-fg2">
      <Show
        when={APPS[props.entry.id].icon}
        fallback={<span class="text-ui font-semibold text-fg">{props.entry.name.slice(0, 1).toUpperCase()}</span>}
      >
        {(Icon) => {
          const I = Icon()
          return <I />
        }}
      </Show>
    </span>
  )
}

export default function Tools(): JSX.Element {
  const apps = useIntegrations()
  const [filter, setFilter] = createSignal<Filter>("all")
  const [query, setQuery] = createSignal("")
  const [openId, setOpenId] = createSignal<AppId | null>(null)

  const entries = createMemo((): Entry[] =>
    (Object.keys(APPS) as AppId[]).map((id) => {
      const state = appState(apps, id)
      return {
        key: `app:${id}`,
        id,
        name: APPS[id].name,
        about: APPS[id].description,
        added: state !== "empty",
        state: state === "connected" ? "Connected" : state === "broken" ? "Key rejected" : "",
      }
    }),
  )

  const shown = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return entries().filter(
      (e) =>
        (filter() === "all" || (filter() === "added") === e.added) &&
        words.every((w) => `${e.name} ${e.about}`.toLowerCase().includes(w)),
    )
  })

  return (
    <div class="flex flex-col gap-4" data-component="tools">
      <div class="flex flex-wrap items-center gap-2">
        <input
          type="search"
          class={cn(fieldClass, "min-w-48 flex-1")}
          placeholder="Search apps"
          aria-label="Search tools"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Segmented<Filter>
          label="Show"
          value={filter()}
          options={[
            { value: "all", label: "All" },
            { value: "added", label: "Added" },
            { value: "available", label: "Available" },
          ]}
          onChange={setFilter}
        />
      </div>
      <div class="kit-card" data-component="tools-list">
        <For each={shown()} fallback={<p class="px-4 py-6 text-center text-ui text-fg2">Nothing matches.</p>}>
          {(entry) => (
            <button
              type="button"
              class="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-hover"
              data-tool={entry.key}
              onClick={() => setOpenId(entry.id)}
            >
              <Glyph entry={entry} />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="flex items-center gap-2 text-ui font-medium text-fg">
                  <span class="truncate">{entry.name}</span>
                  <span class="shrink-0 text-hint font-normal text-fg4">App</span>
                </span>
                <span class="truncate text-label text-fg2">{entry.about}</span>
              </span>
              <Show when={entry.state} fallback={<span class="shrink-0 text-label text-fg2">Connect</span>}>
                <span
                  class={cn(
                    "flex shrink-0 items-center gap-1.5 text-label",
                    entry.state === "Key rejected" ? "text-bad" : "text-ok",
                  )}
                >
                  <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {entry.state}
                </span>
              </Show>
            </button>
          )}
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
          {(id) => <AppDetail id={id} api={apps} />}
        </Show>
      </Dialog>
    </div>
  )
}
