import * as impl from "./overlays-impl"

type Impl = typeof impl

export function part<C>(pick: (impl: Impl) => unknown): C {
  return pick(impl) as C
}
