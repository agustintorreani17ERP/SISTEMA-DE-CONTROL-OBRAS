import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

function mount() {
  const root = document.getElementById("root");
  if (root) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
}

mount();

// La app abre sin conexión en el celular (el navegador solo lo permite en https o localhost)
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
