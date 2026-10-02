import { Router } from "@solidjs/router";
import { Match, Switch, createEffect, lazy, type ParentProps } from "solid-js";
import { useApp } from "./lib/store";
import { render } from "solid-js/web";
import { bootstrapSession, session } from "./app/session";
import "./styles/app.css";
import { routes } from "./app/routes";
import { Shell } from "./app/shell";
import { loadMotion } from "./lib/motion";
import { loadOverlaysV2 } from "@kiko/ui/v2/overlays";

const SignIn = lazy(() => import("./app/sign-in"));

/*
 * The session gates the shell. The cached flag answers on the first frame and
 * `/api/me` confirms it in the background. With no flag the screen stays empty
 * until the first answer, so a signed-in browser never flashes sign-in.
 */
function Root(props: ParentProps) {
  /*
   * Boot order, architecture 19.2: the shell paints first, because an effect
   * runs after the render. Then the data layer opens IndexedDB and paints from
   * it, and only then connects the sockets.
   */
  createEffect(() => {
    const s = session();
    if (s.status === "signed-in") {
      void useApp.start(s.user.id);
      // The saved theme loads after the first paint. The shell script painted from the cache.
      const id = s.user.id;
      setTimeout(() => void import("./theme/live").then((m) => m.startTheme(id)), 0);
    } else if (s.status === "signed-out") {
      useApp.stop();
      void import("./theme/live").then((m) => m.forgetTheme());
    }
  });
  return (
    <Switch>
      <Match when={session().status === "signed-in"}>
        <Shell>{props.children}</Shell>
      </Match>
      <Match when={session().status === "signed-out"}>
        <SignIn />
      </Match>
    </Switch>
  );
}

/* Called by bootstrap.ts once the first route chunk is loaded. */
export function start(): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element #root not found");
  root.replaceChildren();
  void bootstrapSession();
  render(() => <Router root={Root}>{routes}</Router>, root);
  whenIdle(preload);
}

/*
 * Code that first paint does not need, fetched once the shell has painted. Each module also
 * loads itself on first use, so this only makes that first use instant.
 */
function preload(): void {
  void loadOverlaysV2();
  void loadMotion();
}

function whenIdle(task: () => void): void {
  if ("requestIdleCallback" in window) requestIdleCallback(task, { timeout: 1500 });
  else setTimeout(task, 200);
}
