import type { Channel } from "../cdp/session"
import { GZIP_MARK, READ_SCRIPT, settleScript } from "./script"
import type { PageView } from "./types"

export type PageState = {
  channel: Channel
  targetId: string
  labels: Map<number, string>
  crashed?: boolean
  settle?: boolean
  loading?: Promise<unknown>
  notes: string[]
}

export const navigates = (message: string) =>
  /context was destroyed|navigated or closed|Cannot find context/i.test(message)

export async function evaluate<T>(page: PageState, expression: string, awaitPromise = false): Promise<T> {
  if (page.loading) await page.loading
  const settle = page.settle
  page.settle = undefined
  const wrapped = settle === undefined ? expression : `(${settleScript(settle)}).then(() => ${expression})`
  const out = await page.channel.send("Runtime.evaluate", {
    expression: wrapped,
    returnByValue: true,
    awaitPromise: awaitPromise || settle !== undefined,
  })
  if (out.exceptionDetails) {
    const description = out.exceptionDetails.exception?.description ?? out.exceptionDetails.text
    throw new Error(`Page script failed: ${description}`)
  }
  return out.result.value as T
}

export async function flush(page: PageState): Promise<void> {
  if (page.settle !== undefined) {
    await evaluate(page, "true").catch((error: Error) => {
      if (!navigates(error.message)) throw error
    })
  }
  if (page.loading) await page.loading
}

async function gunzip(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
}

async function readOnce(page: PageState): Promise<string> {
  try {
    return await evaluate<string>(page, READ_SCRIPT, true)
  } catch (error) {
    if (!(error instanceof Error) || !navigates(error.message)) throw error
    return evaluate<string>(page, READ_SCRIPT, true)
  }
}

export async function read(page: PageState): Promise<PageView> {
  let raw = await readOnce(page)
  if (page.loading) raw = await readOnce(page)
  const view = JSON.parse(raw.startsWith(GZIP_MARK) ? await gunzip(raw.slice(GZIP_MARK.length)) : raw) as PageView
  for (const control of view.controls) {
    if (control.href?.startsWith("/")) control.href = new URL(control.href, view.url).href
  }
  page.labels = new Map(view.controls.map((control) => [control.id, control.label]))
  return view
}
