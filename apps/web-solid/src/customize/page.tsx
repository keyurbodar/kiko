import { RemixIcon } from "@kiko/ui/remix-icon"
import { PlusIcon } from "@kiko/ui/icons"
import { createSignal, Show } from "solid-js"
import { pageIn } from "../lib/motion"
import { openNewAgent } from "../newagent/state"
import { AppsTab } from "./apps"
import { PageFrame, PageSearch, PageTabs, primaryButton } from "./page-ui"
import { TeamTab } from "./team"

type Tab = "team" | "apps"

export default function CustomizePage() {
  const [tab, setTab] = createSignal<Tab>("team")
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
          <div class="flex items-center gap-1">
            <Show when={tab() === "apps"}>
              <PageSearch label="Search apps" query={query()} onQuery={setQuery} />
            </Show>
            <button type="button" class={`ml-1 ${primaryButton}`} data-action="new-agent" onClick={openNewAgent}>
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
