import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/golos-text/cyrillic-400.css";
import "@fontsource/golos-text/cyrillic-600.css";
import "@fontsource/golos-text/cyrillic-700.css";
import "@fontsource/golos-text/latin-400.css";
import "@fontsource/golos-text/latin-600.css";
import "@fontsource/golos-text/latin-700.css";
import { App } from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
