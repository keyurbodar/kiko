import { render } from "solid-js/web"
import { ThemeProvider } from "@kiko/ui"
import "./styles/app.css"

const root = document.getElementById("root")

if (!root) throw new Error("Root element #root not found")

render(
  () => (
    <ThemeProvider>
      <div />
    </ThemeProvider>
  ),
  root,
)
