import type { DraftFile } from "./rich/draft-files"

export type DraftRestoreDeps<T extends { id: string }> = {
  /** The chat's saved files. */
  list: (key: string) => Promise<DraftFile[]>
  /** The chat the composer shows now. */
  current: () => string | undefined
  /** The ids of the files already in the box. */
  inBox: () => ReadonlySet<string>
  /** Turns one saved file into a box part. Runs before anything is shown. */
  build: (file: DraftFile) => Promise<T>
  /** Drops a built part that is not applied. */
  release: (item: T) => void
  /** Puts the parts in the box, and starts their uploads. */
  apply: (key: string, items: T[]) => void
}

/*
 * Puts a chat's saved files back in its box. Restores overlap: a chat switch can start a second
 * restore for the same chat before the first has listed its files, and both would read the same
 * empty box and add the same chips. So only the latest restore applies, and it checks the box
 * again after its last await. A file is added once, whatever order the restores finish in.
 */
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
