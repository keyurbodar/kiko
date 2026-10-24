import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, PlusIcon, SearchIcon } from "@kiko/ui/icons"
import { createSignal, Show } from "solid-js"
import { pageIn } from "../lib/motion"
import { openNewAgent } from "../newagent/state"
import { AppsTab } from "./apps"
import { PageFrame, PageTabs, ToolButton } from "./page-ui"
import { TeamTab } from "./team"

type Tab = "team" | "apps"

export default function CustomizePage() {
  const [tab, setTab] = createSignal<Tab>("team")
  const [query, setQuery] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  let search: HTMLInputElement | undefined
  const toggleSearch = () => {
    const next = !searching()
    setSearching(next)
    if (next) queueMicrotask(() => search?.focus())
    else setQuery("")
  }
  return (
    <PageFrame title="Customize">
      <div class="flex flex-col gap-6 pt-4" data-component="customize-page">
        <div class="flex items-center justify-between gap-3">
          <PageTabs<Tab>
            label="Customize"
            value={tab()}
            onChange={setTab}
            options={[
              { value: "team", label: "Your team" },
              { value: "apps", label: "Apps" },
            ]}
          />
          <div class="flex items-center gap-1">
            <Show when={tab() === "apps"}>
              <Show when={searching()}>
                <label class="flex h-8 w-[min(220px,40vw)] items-center gap-2 rounded-[9px] bg-panel px-3 text-fg3">
                  <RemixIcon icon={SearchIcon} size={15} />
                  <input
                    ref={search}
                    type="search"
                    class="min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg4"
                    placeholder="Search apps"
                    aria-label="Search apps"
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Escape" && toggleSearch()}
                  />
                </label>
              </Show>
              <ToolButton
                label={searching() ? "Close search" : "Search apps"}
                icon={searching() ? CloseIcon : SearchIcon}
                onClick={toggleSearch}
              />
            </Show>
            <button
              type="button"
              class="ml-1 flex h-8 cursor-pointer items-center gap-2 rounded-[9px] bg-fg px-3 text-[13.5px] font-medium text-bg transition-transform duration-[var(--dur-hover)] active:scale-[0.97]"
              data-action="new-agent"
              onClick={openNewAgent}
            >
              <RemixIcon icon={PlusIcon} size={15} />
              New agent
            </button>
          </div>
        </div>
        <Show
          when={tab() === "team"}
          fallback={
            <div ref={pageIn}>
              <AppsTab query={query()} />
            </div>
          }
        >
          <div ref={pageIn} class="-mt-2 flex flex-col gap-6">
            <p class="text-[14px] text-fg3">Customize the team, not a settings list.</p>
            <TeamTab />
          </div>
        </Show>
      </div>
    </PageFrame>
  )
}
