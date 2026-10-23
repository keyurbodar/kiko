const connection = () => (navigator as { connection?: { saveData?: boolean } }).connection

export function startServiceWorker(warmed: Promise<void>): void {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return
  void navigator.serviceWorker
    .register("/sw.js")
    .then(async () => {
      await warmed
      const registration = await navigator.serviceWorker.ready
      registration.active?.postMessage(connection()?.saveData ? "check" : "precache")
    })
    .catch(() => {})
}
