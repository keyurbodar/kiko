import type { BrowserTab } from "@kiko/protocol"
import { owner, run } from "../../state/runtime"

export async function listBrowserTabs(pcId: string): Promise<readonly BrowserTab[]> {
  const result = await run(owner.commands.browserTabs, { pcId })
  return result._tag === "Success" ? result.value : []
}
