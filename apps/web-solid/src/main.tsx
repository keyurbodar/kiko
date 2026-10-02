import { Router } from "@solidjs/router";
import { Match, Switch, lazy, type ParentProps } from "solid-js";
import { render } from "solid-js/web";
import { bootstrapSession, session } from "./app/session";
import "./styles/app.css";
import { routes } from "./app/routes";
import { Shell } from "./app/shell";

const root = document.getElementById("root");

if (!root) throw new Error("Root element #root not found");

/*
 * The URL is the only source of the active route. The shell is the router's
 * root, so the rail, sidebar and top bar stay mounted and each route swaps in
 * the main panel with no transition.
 */
const SignIn = lazy(() => import("./app/sign-in"));

/*
 * The session gates the shell. The cached flag answers on the first frame and
 * `/api/me` confirms it in the background. With no flag the screen stays empty
 * until the first answer, so a signed-in browser never flashes sign-in.
 */
function Root(props: ParentProps) {
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

void bootstrapSession();
render(() => <Router root={Root}>{routes}</Router>, root);
