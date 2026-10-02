import { Router } from "@solidjs/router";
import { render } from "solid-js/web";
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
render(() => <Router root={Shell}>{routes}</Router>, root);
