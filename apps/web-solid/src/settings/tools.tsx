import { SearchField } from "@kiko/ui/v2/search-field"
import { Segmented } from "@kiko/ui/v2/segmented"
import type { JSX } from "solid-js"
import { createMemo, createSignal, For, Show } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronRightIcon } from "@kiko/ui/icons"
import { Dialog } from "../lib/dialog"
import { cn } from "../lib/cn"
import { AppDetail, type AppId, APPS, appState, useIntegrations } from "./integrations"
import { EmptyState } from "./kit"

type Entry = { key: string; id: AppId; name: string; about: string; added: boolean; state: string }

type Filter = "all" | "added" | "available"

const SEARCH_AFTER = 6

function Glyph(props: { entry: Entry }): JSX.Element {
  return (
    <span class="grid size-8 shrink-0 place-items-center rounded-control bg-[var(--fill-field)] text-[var(--text-200)]">
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
      <Show when={entries().length > SEARCH_AFTER}>
        <div class="flex flex-wrap items-center gap-2">
          <SearchField
            wrapClass="min-w-48 flex-1"
            placeholder="Search apps"
            aria-label="Search tools"
            value={query()}
            onValue={setQuery}
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
      </Show>
      <div class="kit-card flex flex-col gap-0.5 p-1.5" data-component="tools-list">
        <For
          each={shown()}
          fallback={
            <EmptyState
              art="search"
              title="Nothing matches"
              line="Try a shorter word, or show every app."
              data-field="tools-empty"
            />
          }
        >
          {(entry) => (
            <button
              type="button"
              class="group flex min-h-control-big w-full cursor-pointer items-center gap-3 rounded-row px-2.5 py-2 text-left transition-[background-color,transform] duration-(--dur-hover) ease-kiko hover:bg-[var(--fill-hover)] active:scale-[0.99] focus-visible:shadow-[var(--focus-ring)]"
              data-tool={entry.key}
              onClick={() => setOpenId(entry.id)}
            >
              <Glyph entry={entry} />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate type-row text-fg">{entry.name}</span>
                <span class="truncate type-label text-[var(--text-300)]">{entry.about}</span>
              </span>
              <Show
                when={entry.state}
                fallback={
                  <span class="flex shrink-0 items-center gap-0.5 type-label text-fg2 transition-colors duration-(--dur-hover) group-hover:text-fg">
                    Connect
                    <RemixIcon
                      icon={ChevronRightIcon}
                      size={16}
                      class="transition-transform duration-(--dur-hover) ease-kiko group-hover:translate-x-0.5"
                    />
                  </span>
                }
              >
                <span
                  class={cn("shrink-0 type-label", entry.state === "Key rejected" ? "text-[var(--danger)]" : "text-ok")}
                  data-field="tool-state"
                >
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
