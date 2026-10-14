import type { ExtensionCatalogEntry, ExtensionInfo, ExtensionProposal } from "@kiko/protocol"
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { Dialog } from "../lib/dialog"
import { cn } from "../lib/cn"
import { CatalogDetail, InstalledDetail, origin, ProposalDetail, sentence, useExtensions } from "./extensions"
import { AppDetail, type AppId, APPS, appState, useIntegrations } from "./integrations"
import { Button, fieldClass, Notice, Segmented } from "./kit"

/*
 * Tools: every app, extension, and catalog entry in one searchable list. A row says what a thing is
 * and whether it is on. Everything you can do with it lives in its detail, so the list stays short.
 */

type Entry =
  | { key: string; kind: "app"; id: AppId; name: string; about: string; added: boolean; state: string }
  | { key: string; kind: "proposal"; proposal: ExtensionProposal; name: string; about: string; added: false; state: string }
  | { key: string; kind: "extension"; extension: ExtensionInfo; name: string; about: string; added: true; state: string }
  | { key: string; kind: "catalog"; entry: ExtensionCatalogEntry; name: string; about: string; added: false; state: string }

type Filter = "all" | "added" | "available"

const KIND_LABEL: Record<Entry["kind"], string> = { app: "App", proposal: "Extension", extension: "Extension", catalog: "Extension" }

function Glyph(props: { entry: Entry }): JSX.Element {
  return (
    <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-control text-muted-foreground">
      <Show when={props.entry.kind === "app" ? APPS[(props.entry as { id: AppId }).id].icon : null} fallback={<span class="text-md font-semibold text-foreground">{props.entry.name.slice(0, 1).toUpperCase()}</span>}>
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
  const ext = useExtensions()
  const [filter, setFilter] = createSignal<Filter>("all")
  const [query, setQuery] = createSignal("")
  const [openKey, setOpenKey] = createSignal<string | null>(null)

  const entries = createMemo((): Entry[] => {
    const installed = new Set(ext.extensions().map((x) => x.name))
    const waiting = new Set(ext.proposals().map((p) => p.name))
    const list: Entry[] = []
    for (const p of ext.proposals()) list.push({ key: `proposal:${p.id}`, kind: "proposal", proposal: p, name: p.name, about: sentence(p.bundle.manifest.description), added: false, state: "Waiting for you" })
    for (const id of Object.keys(APPS) as AppId[]) {
      const state = appState(apps, id)
      list.push({ key: `app:${id}`, kind: "app", id, name: APPS[id].name, about: APPS[id].description, added: state !== "empty", state: state === "connected" ? "Connected" : state === "broken" ? "Key rejected" : "" })
    }
    for (const x of ext.extensions())
      list.push({ key: `ext:${x.name}`, kind: "extension", extension: x, name: x.name, about: sentence(x.description), added: true, state: x.error ? "Error" : x.enabled ? "On" : "Off" })
    for (const e of ext.entries())
      if (!installed.has(e.name)) list.push({ key: `cat:${e.name}`, kind: "catalog", entry: e, name: e.name, about: sentence(e.description), added: false, state: waiting.has(e.name) ? "Waiting for you" : "" })
    return list
  })

  const shown = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return entries().filter(
      (e) => (filter() === "all" || (filter() === "added") === e.added || e.kind === "proposal") && words.every((w) => `${e.name} ${e.about}`.toLowerCase().includes(w)),
    )
  })
  const open = () => entries().find((e) => e.key === openKey()) ?? null

  return (
    <div class="flex flex-col gap-4" data-component="tools">
      <div class="flex flex-wrap items-center gap-2">
        <input
          type="search"
          class={cn(fieldClass, "min-w-48 flex-1")}
          placeholder="Search apps and extensions"
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
      <Show when={ext.error()}>{(text) => <Notice data-component="extensions-error">{text()}</Notice>}</Show>
      <div class="kit-card" data-component="tools-list">
        <For each={shown()} fallback={<p class="px-4 py-6 text-center text-md text-muted-foreground">{ext.catalog.loading ? "Loading" : "Nothing matches."}</p>}>
          {(entry) => (
            <button
              type="button"
              class="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-accent"
              data-tool={entry.key}
              onClick={() => setOpenKey(entry.key)}
            >
              <Glyph entry={entry} />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="flex items-center gap-2 text-md font-medium text-foreground">
                  <span class="truncate">{entry.name}</span>
                  <span class="shrink-0 text-xs font-normal text-secondary-label">{KIND_LABEL[entry.kind]}</span>
                </span>
                <span class="truncate text-sm text-muted-foreground">{entry.about}</span>
              </span>
              <Show when={entry.state} fallback={<span class="shrink-0 text-sm text-muted-foreground">{entry.kind === "app" ? "Connect" : "Add"}</span>}>
                <span
                  class={cn(
                    "flex shrink-0 items-center gap-1.5 text-sm",
                    entry.state === "Waiting for you" ? "text-ring" : entry.state === "Error" || entry.state === "Key rejected" ? "text-error" : entry.state === "Off" ? "text-muted-foreground" : "text-success",
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
      <div class="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
        <span>Want something that is not here?</span>
        <Button variant="ghost" data-action="ask-kiko" onClick={ext.askKiko}>
          Ask Kiko to build it
        </Button>
      </div>

      <Dialog
        open={open() !== null}
        onClose={() => setOpenKey(null)}
        title={open()?.name ?? ""}
        description={open() ? `${open()!.about}${open()!.kind === "extension" ? ` ${origin((open() as { extension: ExtensionInfo }).extension)}.` : ""}` : undefined}
        size="md"
        data-component="tool-detail"
      >
        <Show when={open()} keyed>
          {(entry) => (
            <Switch>
              <Match when={entry.kind === "app" && entry}>{(e) => <AppDetail id={e().id} api={apps} />}</Match>
              <Match when={entry.kind === "extension" && entry}>{(e) => <InstalledDetail extension={e().extension} run={ext.run} />}</Match>
              <Match when={entry.kind === "proposal" && entry}>
                {(e) => <ProposalDetail proposal={e().proposal} installed={ext.extensions().find((x) => x.name === e().name)} run={ext.run} />}
              </Match>
              <Match when={entry.kind === "catalog" && entry}>
                {(e) => <CatalogDetail entry={e().entry} installed={false} waiting={ext.proposals().some((p) => p.name === e().name)} run={ext.run} />}
              </Match>
            </Switch>
          )}
        </Show>
      </Dialog>
    </div>
  )
}
