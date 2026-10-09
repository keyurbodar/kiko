import { Show } from "solid-js"
import { deferred } from "./deferred"
import type { ToastV2Options, ToastV2PromiseOptions, ToastV2RegionProps } from "./toast-v2-impl"

export type {
  ToastV2Action,
  ToastV2Options,
  ToastV2PromiseOptions,
  ToastV2RegionProps,
  ToastV2Variant,
} from "./toast-v2-impl"

/*
 * The toaster is not needed to paint, so it loads after first paint. The region starts the
 * import when it mounts. A toast shown before the module lands is shown as soon as it does.
 */
const impl = deferred(() => import("./toast-v2-impl"))

export const loadToastV2 = impl.load

function ToastV2Region(props: ToastV2RegionProps) {
  void impl.load()
  return (
    <Show when={impl.module()}>
      {(module) => {
        const Region = module().ToastV2.Region
        return <Region {...props} />
      }}
    </Show>
  )
}

export const ToastV2 = { Region: ToastV2Region }

/* Returns the toast id, or undefined when the toaster was not loaded yet. */
export function showToastV2(options: ToastV2Options | string): number | undefined {
  const module = impl.module()
  if (module) return module.showToastV2(options)
  void impl.load().then((loaded) => loaded.showToastV2(options))
  return undefined
}

export function updateToastV2(id: number, options: ToastV2Options) {
  impl.module()?.updateToastV2(id, options)
}

export function dismissToastV2(id?: number) {
  impl.module()?.dismissToastV2(id)
}

/* A loading toast that becomes the success or error toast when the promise settles. */
export function promiseToastV2<T>(promise: Promise<T>, steps: ToastV2PromiseOptions<T>): Promise<T> {
  void impl.load().then((loaded) => loaded.promiseToastV2(promise, steps))
  return promise
}
