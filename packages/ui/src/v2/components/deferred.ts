import { createSignal, type Accessor } from "solid-js"

/*
 * A module that loads after first paint. `module()` is undefined until it lands, and is a
 * tracked read, so a component can render a plain fallback and switch once it arrives.
 * `load()` is safe to call many times: the import runs once.
 */
export interface Deferred<T> {
  load: () => Promise<T>
  module: Accessor<T | undefined>
}

export function deferred<T>(importer: () => Promise<T>): Deferred<T> {
  const [module, setModule] = createSignal<T>()
  let loading: Promise<T> | undefined
  return {
    load: () =>
      (loading ??= importer().then((value) => {
        setModule(() => value)
        return value
      })),
    module,
  }
}
