import { apiUrl, getToken } from "./lib/api-base";

import { recover, recoveryPending, clearRecovery } from "./lib/chunk-recovery";

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  void recover((event as Event & { payload?: unknown }).payload);
});

declare global {
  var __kikoBoot: { me?: Promise<Response>; token?: string | null; url?: string } | undefined;
}
const token = getToken();
globalThis.__kikoBoot = { token, url: apiUrl("/api/me"), me: fetch(apiUrl("/api/me"), token ? { headers: { authorization: `Bearer ${token}` } } : undefined) };

void Promise.all([import("./main"), import("./app/routes/chat"), import("./app/first-run/frame")])
  .then(async ([main]) => {
    if (recoveryPending()) return;
    await main.start();
    if (!recoveryPending()) clearRecovery();
  })
  .catch(recover);
