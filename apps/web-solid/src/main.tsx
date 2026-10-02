import { Router } from "@solidjs/router";
import { Match, Switch, createEffect, lazy, type ParentProps } from "solid-js";
import { useApp } from "./lib/store";
import { render } from "solid-js/web";
import { bootstrapSession, session } from "./app/session";
import "./styles/app.css";
import { routes } from "./app/routes";
import { Shell } from "./app/shell";

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
    if (s.status === "signed-in") void useApp.start(s.user.id);
    else if (s.status === "signed-out") useApp.stop();
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
}
