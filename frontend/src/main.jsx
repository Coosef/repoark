import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import LoginGate from "./components/LoginGate.jsx";
import { LangProvider } from "./i18n.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LangProvider>
      <LoginGate>
        <App />
      </LoginGate>
    </LangProvider>
  </React.StrictMode>
);

// Register the service worker so the panel is installable ("add to home screen").
// When an updated worker takes control (after a container update), reload once so
// the newest panel loads automatically — no manual cache clearing needed.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) window.location.reload();
      hadController = true;
    });
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
