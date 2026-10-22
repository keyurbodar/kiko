import { createSignal, type Accessor } from "solid-js"

export interface Deferred<T> {
  load: () => Promise<T>
  module: Accessor<T | undefined>
}

export function deferred<T>(importer: () => Promise<T>): Deferred<T> {
  const [module, setModule] = createSignal<T>()
  let loading: Promise<T> | undefined
  return {
    load: () => {
      loading ??= importer()
        .then((value) => {
          setModule(() => value)
          return value
        })
        .catch((error: unknown) => {
          loading = undefined
          throw error
        })
      return loading
    },
    module,
  }
}
