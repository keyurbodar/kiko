type Attach = (paths: readonly string[]) => void

let active: Attach | undefined

export function attachFileRefs(paths: readonly string[]): boolean {
  if (!active || !paths.length) return false
  active(paths)
  return true
}

export function receiveFileRefs(attach: Attach): () => void {
  active = attach
  return () => {
    if (active === attach) active = undefined
  }
}
