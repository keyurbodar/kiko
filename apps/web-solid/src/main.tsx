import { Router } from "@solidjs/router";
import { Match, Switch, createEffect, lazy, type ParentProps } from "solid-js";
import { useApp } from "./lib/store";
import { render } from "solid-js/web";
import { bootstrapSession, session } from "./app/session";
import "./index.css";
import { routes } from "./app/routes";
import { Shell } from "./app/shell";
import { loadMotion } from "./lib/motion";
import { loadOverlaysV2 } from "@kiko/ui/v2/overlays";
import { startSnapshots } from "./lib/snapshot";

const SignIn = lazy(() => import("./app/sign-in"));

function Root(props: ParentProps) {
  createEffect(() => {
    const s = session();
    if (s.status === "signed-in") {
      void useApp.start(s.user.id);
      const id = s.user.id;
      setTimeout(() => void import("./theme/live").then((m) => m.startTheme(id)), 0);
      setTimeout(() => void import("./settings/timezone").then((m) => m.syncTimeZone()), 2000);
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

export function start(): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element #root not found");
  root.replaceChildren();
  void bootstrapSession();
  render(() => <Router root={Root}>{routes}</Router>, root);
  startSnapshots(() => {
    const s = session().status;
    if (s === "signed-out") return true;
    if (s !== "signed-in") return false;
    const id = useApp.activeThreadId();
    return !location.pathname.startsWith("/chat") || !id || !!useApp.room()?.state.loaded;
  });
  whenIdle(preload);
}

function preload(): void {
  void loadOverlaysV2();
  void loadMotion();
}

function whenIdle(task: () => void): void {
  if ("requestIdleCallback" in window) requestIdleCallback(task, { timeout: 1500 });
  else setTimeout(task, 200);
}
