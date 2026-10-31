import { RemixIcon } from "@kiko/ui/remix-icon"
import { PlusIcon } from "@kiko/ui/icons"
import { createSignal, Show } from "solid-js"
import { pageIn } from "../lib/motion"
import { openNewAgent } from "../newagent/state"
import { Segmented } from "@kiko/ui/v2/segmented"
import { AppsTab, type Scope } from "./apps"
import { PageFrame, PageSearch, PageTabs, primaryButton } from "./page-ui"
import { TeamTab } from "./team"

type Tab = "team" | "apps"

export default function CustomizePage() {
  const [tab, setTab] = createSignal<Tab>("team")
  const [scope, setScope] = createSignal<Scope>("discover")
  const [query, setQuery] = createSignal("")
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
          <div class="flex items-center gap-2">
            <Show when={tab() === "apps"}>
              <Segmented<Scope>
                label="Apps"
                value={scope()}
                onChange={setScope}
                options={[
                  { value: "yours", label: "Yours" },
                  { value: "discover", label: "Discover" },
                ]}
              />
              <PageSearch label="Search apps" query={query()} onQuery={setQuery} />
            </Show>
            <Show
              when={tab() === "apps"}
              fallback={
                <button type="button" class={primaryButton} data-action="new-agent" onClick={openNewAgent}>
                  <RemixIcon icon={PlusIcon} size={14} />
                  New agent
                </button>
              }
            >
              <button type="button" class={primaryButton} data-action="add-app" onClick={() => setScope("discover")}>
                <RemixIcon icon={PlusIcon} size={14} />
                Add
              </button>
            </Show>
          </div>
        </div>
        <Show
          when={tab() === "team"}
          fallback={
            <div ref={pageIn}>
              <AppsTab query={query()} scope={scope()} />
            </div>
          }
        >
          <div ref={pageIn} class="-mt-2 flex flex-col gap-6">
            <p class="type-base text-tertiary">Your agents, what they know and what they can use.</p>
            <TeamTab />
          </div>
        </Show>
      </div>
    </PageFrame>
  )
}
