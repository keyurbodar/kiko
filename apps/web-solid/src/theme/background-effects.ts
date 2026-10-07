// The chat background's effects, drawn by a worker so a large picture never blocks a frame.
// Ported from monocode (MIT): src/features/settings/model/newThreadBackgroundEffects.ts. Each
// result is cached by picture, effect and appearance, so switching back is free.

import type { BackgroundEffect } from "./glass"

type Reply = { id: number; result?: Blob; error?: string }

let worker: Worker | null = null
let next = 0
const pending = new Map<number, { resolve: (b?: Blob) => void; reject: (e: Error) => void }>()
const loaded = new Map<string, Promise<void>>()
const rendered = new Map<string, Promise<Blob>>()

function backgroundWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL("./background-effects.worker.ts", import.meta.url), { type: "module" })
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve(data.result)
  }
  return worker
}

function ask(message: object, transfer: Transferable[] = []): Promise<Blob | undefined> {
  const id = ++next
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    backgroundWorker().postMessage({ ...message, id }, transfer)
  })
}

/** A failure is forgotten, so the next try runs again. */
function remember<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let entry = map.get(key)
  if (!entry) {
    entry = make()
    map.set(key, entry)
    entry.catch(() => map.get(key) === entry && map.delete(key))
  }
  return entry
}

export function renderEffect(sourceKey: string, src: string, effect: BackgroundEffect, light: boolean): Promise<Blob> {
  // Only ascii, halftone and scanlines draw on paper that follows the appearance.
  const paper = effect === "none" || effect === "dither" ? false : light
  return remember(rendered, `${sourceKey}:${effect}:${paper}`, async () => {
    await remember(loaded, sourceKey, async () => {
      const bytes = await (await fetch(src)).arrayBuffer()
      await ask({ kind: "load", sourceKey, bytes }, [bytes])
    })
    const blob = await ask({ kind: "render", sourceKey, effect, light: paper })
    if (!blob) throw new Error("the effect returned no picture")
    return blob
  })
}
