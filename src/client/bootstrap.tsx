import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import type { AppId } from "./apps";
import "./index.css";

/** Monta la app indicada (ERP o ECMS): cada HTML de entrada llama a esto con la suya. */
export function mount(app: AppId) {
  const root = document.getElementById("root");
  if (root) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App app={app} />
      </React.StrictMode>
    );
  }
}


// La app abre sin conexión en el celular (el navegador solo lo permite en https o localhost)
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
