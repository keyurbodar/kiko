import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@workspace/ui/globals.css";
import "blobatar/motion.css";
import "./theme.css";
import App from "./app";
import { CardsDemo } from "./components/chat/cardsDemo";

const rootElement = document.querySelector("#root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const root = createRoot(rootElement);

if (location.search.includes("cards-demo=1")) {
  root.render(<CardsDemo />);
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
