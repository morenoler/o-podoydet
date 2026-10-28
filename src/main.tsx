import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/inter";
import { App } from "./App";
import "./styles.css";
import "./shared/ui/design-v2.css";
import "./shared/ui/figcraft-theme.css";
import "./features/search/figcraft-controls.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
