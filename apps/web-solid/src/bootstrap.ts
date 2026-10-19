/*
 * Tier 1 entry. Tiny on purpose: it loads tier 2 with a dynamic import and
 * holds the HTML shell until the first route's chunk is in, then swaps.
 */

import { apiUrl, getToken } from "./lib/api-base";

import { recover, recoveryPending, clearRecovery } from "./lib/chunk-recovery";

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  void recover((event as Event & { payload?: unknown }).payload);
});

// Start the session check alongside the initial chunks.
declare global {
  var __kikoBoot: { me?: Promise<Response>; token?: string | null; url?: string } | undefined;
}
const token = getToken();
globalThis.__kikoBoot = { token, url: apiUrl("/api/me"), me: fetch(apiUrl("/api/me"), token ? { headers: { authorization: `Bearer ${token}` } } : undefined) };

// Same specifier as `app/routes.tsx`, so the bundler shares the chunk. Every first paint is a chat: a
// `/settings` link opens the settings dialog over one, and the dialog loads when the redirect opens it.
void Promise.all([import("./main"), import("./app/routes/chat"), import("./app/first-run/frame")])
  .then(async ([main]) => {
    if (recoveryPending()) return;
    await main.start();
    if (!recoveryPending()) clearRecovery();
  })
  .catch(recover);
