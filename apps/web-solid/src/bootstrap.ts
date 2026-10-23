import { apiUrl, getToken } from "./lib/api-base"

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

declare global {
  var __kikoBoot: { me?: Promise<Response>; token?: string | null; url?: string } | undefined
}
const token = getToken()
globalThis.__kikoBoot = {
  token,
  url: apiUrl("/api/me"),
  me: token ? fetch(apiUrl("/api/me"), { headers: { authorization: `Bearer ${token}` } }) : undefined,
}

void Promise.all([import("./main"), import("./app/routes/chat"), token ? undefined : import("./app/first-run/frame")])
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
