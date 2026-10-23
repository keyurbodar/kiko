import { startServiceWorker } from "./service-worker"

const QUIET_MS = 8_000

export function warmApp(): void {
  startServiceWorker(new Promise((resolve) => setTimeout(resolve, QUIET_MS)))
}
