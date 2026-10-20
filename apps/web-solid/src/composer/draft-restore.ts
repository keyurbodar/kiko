import type { DraftFile } from "./rich/draft-files"

export type DraftRestoreDeps<T extends { id: string }> = {
  list: (key: string) => Promise<DraftFile[]>
  current: () => string | undefined
  inBox: () => ReadonlySet<string>
  build: (file: DraftFile) => Promise<T>
  release: (item: T) => void
  apply: (key: string, items: T[]) => void
}

export function createDraftRestore<T extends { id: string }>(deps: DraftRestoreDeps<T>) {
  let latest = 0
  return async (key: string): Promise<void> => {
    const generation = ++latest
    const saved = await deps.list(key)
    const built = await Promise.all(saved.filter((file) => !deps.inBox().has(file.id)).map((file) => deps.build(file)))
    const have = deps.inBox()
    const current = generation === latest && deps.current() === key
    const items = current ? built.filter((item) => !have.has(item.id)) : []
    for (const item of built) if (!items.includes(item)) deps.release(item)
    if (items.length) deps.apply(key, items)
  }
}
