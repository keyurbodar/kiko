import { Router } from "@solidjs/router";
import { ErrorBoundary, Match, Switch, createEffect, lazy, type ParentProps } from "solid-js";
import { useApp } from "./lib/store";
import { render } from "solid-js/web";
import { currentStep } from "./app/first-run/progress";
import { bootstrapSession, session } from "./app/session";
import "./index.css";
import { routes } from "./app/routes";
import { Shell } from "./app/shell";
import { loadOverlaysV2 } from "@kiko/ui/v2/overlays";
import { applyCommitted } from "@kiko/theme/apply";
import { DEFAULT_LOOK } from "@kiko/theme/look";

const FirstRun = lazy(() => import("./app/first-run/frame"));

function Broken(props: { error: unknown; reset: () => void }) {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error));
  return (
    <div class="grid min-h-dvh place-items-center p-6" role="alert" data-component="crash">
      <div class="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 class="text-lg font-medium text-foreground">Something in this view broke</h1>
        <p class="text-sm text-muted-foreground break-words">{message()}</p>
        <div class="flex gap-2">
          <button type="button" class="rounded-md bg-accent px-3 py-1.5 text-sm text-foreground hover:bg-accent-strong" onClick={props.reset}>
            Try again
          </button>
          <button type="button" class="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

function Root(props: ParentProps) {
  createEffect(() => {
    const s = session();
    if (s.status === "signed-in") {
      void useApp.start(s.user.id);
      const id = s.user.id;
      setTimeout(() => void import("./theme/live").then((m) => m.startTheme(id)), 0);
      setTimeout(() => void import("./settings/timezone").then((m) => m.syncTimeZone()), 2000);
    } else if (s.status === "signed-out") {
      applyCommitted(DEFAULT_LOOK, false);
      useApp.stop();
      void import("./theme/live").then((m) => m.forgetTheme());
    }
  });
  return (
    <ErrorBoundary fallback={(error, reset) => <Broken error={error} reset={reset} />}>
      <Switch>
        <Match when={currentStep() !== "done"}>
          <FirstRun />
        </Match>
        <Match when={session().status === "signed-in"}>
          <Shell>{props.children}</Shell>
        </Match>
      </Switch>
    </ErrorBoundary>
  );
}

export async function start(): Promise<void> {
  await FirstRun.preload();
  if (session().status !== "signed-in") applyCommitted(DEFAULT_LOOK, false);
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element #root not found");
  void bootstrapSession();
  root.replaceChildren();
  render(() => <Router root={Root}>{routes}</Router>, root);
  void loadOverlaysV2().catch(() => {});
  whenIdle(preload);
}

function preload(): void {
  void loadOverlaysV2();
}

function whenIdle(task: () => void): void {
  if ("requestIdleCallback" in window) requestIdleCallback(task, { timeout: 1500 });
  else setTimeout(task, 200);
}
