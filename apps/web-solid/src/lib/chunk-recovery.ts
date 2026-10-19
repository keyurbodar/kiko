const RELOAD_KEY = "kiko:preload-reload"
let pending = false

export const recoveryPending = () => pending
export function clearRecovery(): void {
  try { sessionStorage.removeItem(RELOAD_KEY) } catch {}
}

export async function recover(error: unknown): Promise<void> {
  if (pending) return
  pending = true
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) throw new Error("Already retried")
    sessionStorage.setItem(RELOAD_KEY, "1")
  } catch {
    const el = document.getElementById("boot-error")
    if (el) el.style.display = "block"
    return
  }
  await Promise.all([...new Set(String(error).match(/\/assets\/[^\s"'<>]+?\.js/g) ?? [])].map((file) =>
    fetch(file, { cache: "reload", signal: AbortSignal.timeout(3000) }).catch(() => {}),
  ))
  location.reload()
}
