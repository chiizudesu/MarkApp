import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "@/components/ui/provider";
import { App } from "@/App";
import "@/editor.css";

const el = document.getElementById("root");
if (!el) throw new Error("root missing");

createRoot(el).render(
  <React.StrictMode>
    <Provider defaultTheme="dark">
      <App />
    </Provider>
  </React.StrictMode>,
);
