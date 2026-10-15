// Tells the owner when the backend is older than this app, or too old to talk to. Build item 1, docs/app-yuki-codes.md.
import { Show } from "solid-js";
import { Hint, Notice } from "../settings/kit";
import { useApp } from "../lib/store";
import { APP_VERSION } from "../lib/version-skew";

export function VersionBanner() {
  const skew = () => useApp.user()?.state.skew;
  const versions = () => (
    <>
      <span data-part="app-version">App {APP_VERSION}</span>
      <span data-part="backend-version">Backend {useApp.user()?.state.backendVersion ?? "unknown"}</span>
    </>
  );
  return (
    <Show when={skew() === "update" || skew() === "blocked"}>
      <div class="fixed inset-x-0 top-0 z-50 bg-[var(--sidebar)] px-3 py-1" data-component="version-banner">
        <Show
          when={skew() === "blocked"}
          fallback={
            <Hint>
              <span>Update available</span> {versions()}
            </Hint>
          }
        >
          <Notice>
            <span>Update your backend to keep using Kiko</span> {versions()}
          </Notice>
        </Show>
      </div>
    </Show>
  );
}
