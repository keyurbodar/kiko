import { render } from "solid-js/web"
import { ThemeProvider } from "@kiko/ui"
import { WHIRL_THEME, applyThemePalette } from "@kiko/ui/app-theme"
import "./styles/app.css"

const root = document.getElementById("root")

if (!root) throw new Error("Root element #root not found")

applyThemePalette(WHIRL_THEME)

render(
  () => (
    <ThemeProvider>
      <div />
    </ThemeProvider>
  ),
  root,
)
