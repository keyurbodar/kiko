import { hasAuth, prepareStorage } from "./lib/storage"

prepareStorage()

const RELOAD_KEY = "kiko:chunk-reload"
let chunkFailed = false
let reloading = false

function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false
    sessionStorage.setItem(RELOAD_KEY, "1")
  } catch {
    return false
  }
  location.reload()
  return true
}

window.addEventListener("vite:preloadError", () => {
  chunkFailed = true
  reloading ||= reloadOnce()
})

void Promise.all([import("./main"), import("./app/chat-view"), hasAuth() ? undefined : import("./app/first-run/frame")])
  .then(async ([main]) => {
    if (reloading) return
    await main.start()
    if (chunkFailed) return
    try {
      sessionStorage.removeItem(RELOAD_KEY)
    } catch {}
  })
  .catch(() => {
    if (reloading) return
    const el = document.getElementById("boot-error")
    if (el) el.style.display = "block"
  })
