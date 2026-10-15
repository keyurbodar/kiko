import type { JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import Appearance from "../theme/appearance"
import Initiative from "./initiative"
import { Account } from "./account"
import { Page } from "./kit"
import { ModelsPage } from "./models"
import { SETTINGS_SECTIONS } from "./sections"
import Tools from "./tools"

/*
 * The settings route body: the section the URL names. The section list lives in the sidebar
 * (`sidebar/settings/sidebar.tsx`). Every section ships in the settings chunk, so moving between
 * them never waits on the network.
 */

function General() {
  return <Initiative />
}

const COMPONENTS: Record<string, () => JSX.Element> = { models: ModelsPage, tools: Tools, appearance: Appearance, general: General, account: Account }

export function SettingsShell(props: { sectionId: string }) {
  const meta = () => SETTINGS_SECTIONS.find((s) => s.id === props.sectionId)
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 md:px-4 md:pb-4" data-component="settings">
      <div class="@container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-component="settings-body">
        <div class="mx-auto w-full max-w-3xl px-5 py-6 pb-16 max-[767px]:pt-14 @min-[560px]/settings:px-8 @min-[560px]/settings:py-8">
          <Page title={meta()?.label ?? "Settings"} description={meta()?.hint}>
            <Dynamic component={COMPONENTS[props.sectionId] ?? ModelsPage} />
          </Page>
        </div>
      </div>
    </div>
  )
}
