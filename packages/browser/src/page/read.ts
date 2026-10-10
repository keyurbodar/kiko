import type { Channel } from "../cdp/session"
import { GZIP_MARK, READ_SCRIPT } from "./script"
import type { PageView } from "./types"

/** What one tab's page layer keeps between calls. */
export type PageState = {
  channel: Channel
  targetId: string
  /** The label each id had at the last read. The click guard compares against it. */
  labels: Map<number, string>
  /** A confirm or prompt that was dismissed and not yet reported. */
  dialog?: string
  crashed?: boolean
}

export async function evaluate<T>(page: PageState, expression: string, awaitPromise = false): Promise<T> {
  const out = await page.channel.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise })
  if (out.exceptionDetails) {
    const description = out.exceptionDetails.exception?.description ?? out.exceptionDetails.text
    throw new Error(`Page script failed: ${description}`)
  }
  return out.result.value as T
}

async function gunzip(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
}

export async function read(page: PageState): Promise<PageView> {
  const raw = await evaluate<string>(page, READ_SCRIPT, true)
  const view = JSON.parse(raw.startsWith(GZIP_MARK) ? await gunzip(raw.slice(GZIP_MARK.length)) : raw) as PageView
  for (const control of view.controls) {
    if (control.href?.startsWith("/")) control.href = new URL(control.href, view.url).href
  }
  page.labels = new Map(view.controls.map((control) => [control.id, control.label]))
  return view
}
