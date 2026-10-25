import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/nunito-sans/cyrillic-400.css";
import "@fontsource/nunito-sans/cyrillic-600.css";
import "@fontsource/nunito-sans/cyrillic-700.css";
import "@fontsource/nunito-sans/cyrillic-800.css";
import "@fontsource/nunito-sans/latin-400.css";
import "@fontsource/nunito-sans/latin-600.css";
import "@fontsource/nunito-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-800.css";
import { App } from "./App";
import "./styles.css";
import "./shared/ui/design-v2.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
